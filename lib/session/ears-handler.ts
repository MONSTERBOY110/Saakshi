import type { EarsEvent } from "@/lib/aai/ears";
import type { Analysis, AnalyzeRequest } from "@/lib/analyzer/schema";
import { evaluateTurn, type Evaluation } from "@/lib/rules/engine";
import { applyCorrections, applyEvaluation, applyNotes } from "./board";
import type { RoomController } from "./controller";
import { isAgentEcho } from "./echo";
import { startIntervention } from "./flows";
import { fuse, type AnalyzerNote } from "./fusion";
import { bindKnownSpeaker, observeFinalTurn, rolesBound } from "./roles";
import {
  applyRevision,
  applyTurn,
  markEcho,
  previousFinal,
  reassignRoles,
  type StoredTurn,
} from "./transcript";
import { guardAdvisorAnswer } from "./teachback";
import { isVerifyTrigger } from "./verify-trigger";

// Streaming STT events into room state: transcript, calibration, the rule engine, fusion with the
// analyzer, and the interventions and nudges those produce. Wire-level type names are kept in the
// debug log so the drawer and the live specs read the same names as the AssemblyAI docs.

const ANALYZER_WINDOW = 8;

const EARS_WIRE: Partial<Record<EarsEvent["type"], string>> = {
  begin: "Begin",
  turn: "Turn",
  speaker_revision: "SpeakerRevision",
  heartbeat: "Heartbeat",
  speech_started: "SpeechStarted",
  termination: "Termination",
};

export function handleEarsEvent(c: RoomController, e: EarsEvent): void {
  if (e.type === "unparsed") return c.log("stt", "unparsed", e);
  if (e.type === "unknown") return c.log("stt", e.eventType, e.payload);
  const client =
    e.type === "status" || e.type === "closed" || e.type === "gap" || e.type === "reconnect_failed";
  c.log(client ? "client" : "stt", EARS_WIRE[e.type] ?? `ears.${e.type}`, e);
  switch (e.type) {
    case "status":
      return c.set((s) => ({ status: { ...s.status, ears: e.status } }));
    case "begin":
      return c.set((s) => ({ status: { ...s.status, earsSessionId: e.sessionId } }));
    case "heartbeat":
      return c.set((s) => ({
        status: {
          ...s.status,
          heartbeat: {
            audioMs: e.heartbeat.total_audio_received_ms,
            realtimeFactor: e.heartbeat.realtime_factor,
            wallMs: Math.round(performance.now() - c.t0),
          },
        },
      }));
    case "gap":
      // The Ears report the raw clock; the certificate wants milliseconds since the session began.
      return c.set((s) => ({
        gaps: [
          ...s.gaps,
          {
            fromMs: Math.max(0, Math.round(e.fromMs - c.t0)),
            toMs: Math.round(e.toMs - c.t0),
            code: e.code,
          },
        ],
      }));
    case "turn":
      return onTurn(c, e);
    case "speaker_revision": {
      const r = applyRevision(c.state.transcript, e.revision, c.roleOf);
      c.set({ transcript: r.state });
      if (r.changed.length > 0) c.rebuild();
      return;
    }
    default:
      return;
  }
}

function onTurn(c: RoomController, e: Extract<EarsEvent, { type: "turn" }>): void {
  const detectedAt = performance.now();
  // Any turn, partial or final, means someone is talking; judge-solo waits for a gap.
  c.lastTurnAt = detectedAt;
  const r = applyTurn(c.state.transcript, e.turn, c.roleOf);
  c.set({ transcript: r.state });
  const finalized = r.finalized;
  if (!finalized) {
    if (r.updated) c.rebuild();
    return;
  }
  // Saakshi hearing herself through the speakers is not evidence.
  if (isAgentEcho(finalized.text, c.recentAgentSpeech)) {
    c.log("client", "echo.ignored", { turn: finalized.order, text: finalized.text.slice(0, 120) });
    c.set((s) => ({ transcript: markEcho(s.transcript, finalized.order) }));
    return;
  }
  calibrate(c, finalized);
  // Judge-solo: a line that waits for the customer is released by the customer actually speaking.
  const role = c.state.transcript.turns.find((t) => t.order === finalized.order)?.role;
  if (role === "customer") c.judgeSolo?.customerSpoke();
  runRules(c, finalized, detectedAt);
}

function calibrate(c: RoomController, turn: StoredTurn): void {
  const { roles, setup, phase } = c.state;
  if (rolesBound(roles)) return;
  // In judge-solo the room starts watching once the advisor is known, so the customer is still
  // waiting to be recognised after the phase has moved on. Everywhere else, calibration is a phase.
  if (phase !== "CALIBRATE" && !(c.judgeSolo && phase === "OBSERVE")) return;
  // Judge-solo: the room played the advisor's voice itself, so it does not have to infer who spoke.
  // Anyone talking when he is not is the judge. That makes calibration deterministic, which is what
  // a three minute solo demo needs, and it survives a name the recogniser wrote in another script.
  const next = c.judgeSolo
    ? bindKnownSpeaker(
        roles,
        turn.speakerLabel,
        c.judgeSolo.spokeRecently() ? "advisor" : "customer",
      )
    : observeFinalTurn(
        roles,
        { label: turn.speakerLabel, text: turn.text },
        { advisor: setup.advisorName, customer: setup.customerName },
      );
  if (next.state === roles) return;
  c.log("client", "roles", {
    bound: next.bound,
    advisor: next.state.advisor,
    customer: next.state.customer,
  });
  c.set({ roles: next.state });
  c.set((s) => ({ transcript: reassignRoles(s.transcript, c.roleOf) }));
  c.rebuild();
  c.onRolesChanged();
}

/**
 * How long the recogniser took between the speaker stopping and us seeing the finalized turn.
 * Word timings are on the server's audio timeline, which starts at the first frame it accepted;
 * a heartbeat gives a second reading of that clock and corrects any drift.
 */
function sttLagOf(c: RoomController, turn: StoredTurn, detectedAt: number): number | undefined {
  const origin = audioClockOrigin(c);
  if (origin === null) {
    c.log("client", "latency.no_anchor", { turn: turn.order, reason: "audio clock not started" });
    return undefined;
  }
  const lag = detectedAt - origin - turn.endMs;
  // Outside this window the audio clock is wrong rather than the room being slow, so the number is
  // dropped and the badge says so. It is logged because a silent drop once cost an hour to find.
  if (lag < 0 || lag >= 10_000) {
    c.log("client", "latency.no_anchor", {
      turn: turn.order,
      reason: "lag outside the plausible window",
      lag: Math.round(lag),
      endMs: turn.endMs,
    });
    return undefined;
  }
  return Math.round(lag);
}

/** performance.now() that corresponds to audio-timeline zero. */
function audioClockOrigin(c: RoomController): number | null {
  const hb = c.state.status.heartbeat;
  // A heartbeat states how much audio the server had received at a known wall time.
  if (hb) return c.t0 + hb.wallMs - hb.audioMs;
  return c.audioClockStart;
}

function runRules(c: RoomController, turn: StoredTurn, detectedAt: number): void {
  if (!c.pack || !c.state.board) return;
  const current = c.state.transcript.turns.find((t) => t.order === turn.order) ?? turn;
  if (!current.role) return;

  // In teach-back the customer's answers are the evidence, not the pitch, so the rule engine stands
  // down. The one thing that matters is who is speaking: the advisor must not answer for her.
  if (c.state.phase === "TEACHBACK") {
    if (current.role === "advisor") guardAdvisorAnswer(c);
    return;
  }

  // "Saakshi, verify" ends the pitch (P0-6) and is not evidence about the product.
  if (current.role === "advisor" && c.state.phase === "OBSERVE" && isVerifyTrigger(current.text)) {
    c.verify("spoken", current.order);
    return;
  }

  const prev = previousFinal(c.state.transcript, current.order);
  const rules = evaluateTurn(
    c.pack,
    { order: current.order, role: current.role, text: current.text },
    prev ? { order: prev.order, role: prev.role, text: prev.text } : undefined,
  );

  const fused = fuse({
    rules,
    analysis: null,
    rate: c.rate,
    now: detectedAt,
    alreadyIntervened: c.intervened,
  });
  c.rate = fused.rate;
  applyToBoard(c, fused.evaluation, current.order);
  applyNotesToBoard(c, fused.notes);

  if (rules.corrections.length > 0) {
    c.log("client", "corrections", { turn: current.order, ids: rules.corrections });
  }
  if (fused.interventions.length > 0) {
    const first = fused.interventions[0]!;
    for (const i of fused.interventions) c.intervened.add(`${i.id}@${i.turnOrder}`);
    startIntervention(c, first, detectedAt, sttLagOf(c, current, detectedAt));
  } else if (current.role === "advisor") {
    scheduleAnalysis(c);
  }
}

function applyToBoard(c: RoomController, evaluation: Evaluation, turnOrder: number): void {
  const turns = c.state.transcript.turns;
  const found =
    evaluation.checkpoints.length +
    evaluation.violations.length +
    evaluation.customerBeliefs.length;
  if (found > 0) {
    c.log("client", "rules", {
      turn: turnOrder,
      checkpoints: evaluation.checkpoints.map((m) => m.id),
      violations: evaluation.violations.map((m) => m.id),
      beliefs: evaluation.customerBeliefs.map((m) => m.id),
    });
  }
  c.set((s) => {
    if (!s.board) return {};
    let board = applyEvaluation(s.board, evaluation, (o) => turns.find((t) => t.order === o));
    board = applyCorrections(board, evaluation.corrections, turnOrder);
    return { board };
  });
}

/** Layer 2 runs on a small budget (docs/decisions.md), over the last eight finalized turns. */
function scheduleAnalysis(c: RoomController): void {
  if (!c.analyzer || !c.pack) return;
  const turns = c.state.transcript.turns
    .filter((t) => t.final && !t.echo && t.role)
    .slice(-ANALYZER_WINDOW);
  if (turns.length === 0) return;
  const request: AnalyzeRequest = {
    pack_id: c.pack.id,
    context: {
      advisor: c.state.setup.advisorName,
      customer: c.state.setup.customerName,
      product: c.state.setup.productName,
    },
    turns: turns.map((t) => ({
      order: t.order,
      role: t.role as "advisor" | "customer",
      text: t.text,
      start_ms: t.startMs,
    })),
  };
  c.set((s) => ({ analyzer: { ...s.analyzer, status: "running" } }));
  c.analyzer.schedule(request);
}

/** Fuse a completed analysis with the rules for the newest turn in its window. */
export function applyAnalysis(c: RoomController, analysis: Analysis, lastOrder: number): void {
  if (!c.pack || !c.state.board) return;
  const turn = c.state.transcript.turns.find((t) => t.order === lastOrder);
  if (!turn?.role) return;
  const prev = previousFinal(c.state.transcript, turn.order);
  const rules = evaluateTurn(
    c.pack,
    { order: turn.order, role: turn.role, text: turn.text },
    prev ? { order: prev.order, role: prev.role, text: prev.text } : undefined,
  );
  const fused = fuse({
    rules,
    analysis,
    rate: c.rate,
    now: performance.now(),
    alreadyIntervened: c.intervened,
  });
  c.rate = fused.rate;
  // The analyzer is advisory (fusion.ts): its findings are notes for the reviewer. Interventions
  // come from the rules alone and were decided when the turn arrived, so nothing is spoken here.
  applyToBoard(c, fused.evaluation, turn.order);
  applyNotesToBoard(c, fused.notes);
}

/** The analyzer's findings go to the reviewer's notes. They never tick, flag or speak. */
function applyNotesToBoard(c: RoomController, notes: AnalyzerNote[]): void {
  if (notes.length === 0) return;
  const turns = c.state.transcript.turns;
  c.log("client", "analyzer.notes", {
    notes: notes.map((n) => `${n.kind}:${n.id}@${n.turnOrder}:${n.confidence.toFixed(2)}`),
  });
  c.set((s) =>
    s.board ? { board: applyNotes(s.board, notes, (o) => turns.find((t) => t.order === o)) } : {},
  );
}
