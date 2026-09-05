import type { EarsEvent } from "@/lib/aai/ears";
import type { MouthEvent } from "@/lib/aai/mouth";
import { evaluateTurn } from "@/lib/rules/engine";
import { applyEvaluation } from "./board";
import type { RoomController } from "./controller";
import { observeFinalTurn, rolesBound } from "./roles";
import {
  applyRevision,
  applyTurn,
  previousFinal,
  reassignRoles,
  type StoredTurn,
} from "./transcript";

// Socket events into room state. Wire-level type names are kept in the debug log so the drawer
// and the live E2E filters read the same names as the AssemblyAI docs.

const EARS_WIRE: Partial<Record<EarsEvent["type"], string>> = {
  begin: "Begin",
  turn: "Turn",
  speaker_revision: "SpeakerRevision",
  heartbeat: "Heartbeat",
  speech_started: "SpeechStarted",
  termination: "Termination",
};

const MOUTH_WIRE: Partial<Record<MouthEvent["type"], string>> = {
  ready: "session.ready",
  updated: "session.updated",
  error: "session.error",
  ended: "session.ended",
  speech_started: "input.speech.started",
  speech_stopped: "input.speech.stopped",
  user_delta: "transcript.user.delta",
  user_final: "transcript.user",
  reply_started: "reply.started",
  reply_audio: "reply.audio",
  agent_delta: "transcript.agent.delta",
  agent_final: "transcript.agent",
  reply_done: "reply.done",
  tool_call: "tool.call",
};

export function handleEarsEvent(c: RoomController, e: EarsEvent): void {
  if (e.type === "unparsed") return c.log("stt", "unparsed", e);
  if (e.type === "unknown") return c.log("stt", e.eventType, e.payload);
  c.log(
    e.type === "status" || e.type === "closed" || e.type === "gap" || e.type === "reconnect_failed"
      ? "client"
      : "stt",
    EARS_WIRE[e.type] ?? `ears.${e.type}`,
    e,
  );
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
      return c.set((s) => ({
        gaps: [...s.gaps, { fromMs: e.fromMs, toMs: e.toMs, code: e.code }],
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
  const r = applyTurn(c.state.transcript, e.turn, c.roleOf);
  c.set({ transcript: r.state });
  if (r.finalized) {
    calibrate(c, r.finalized);
    runRules(c, r.finalized);
  } else if (r.updated) {
    c.rebuild();
  }
}

function calibrate(c: RoomController, turn: StoredTurn): void {
  const { roles, setup, phase } = c.state;
  if (phase !== "CALIBRATE" || rolesBound(roles)) return;
  const next = observeFinalTurn(
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

function runRules(c: RoomController, turn: StoredTurn): void {
  if (!c.pack || !c.state.board) return;
  const current = c.state.transcript.turns.find((t) => t.order === turn.order) ?? turn;
  if (!current.role) return;
  const prev = previousFinal(c.state.transcript, current.order);
  const evaluation = evaluateTurn(
    c.pack,
    { order: current.order, role: current.role, text: current.text },
    prev ? { order: prev.order, role: prev.role, text: prev.text } : undefined,
  );
  if (
    evaluation.checkpoints.length +
      evaluation.violations.length +
      evaluation.customerBeliefs.length ===
    0
  )
    return;
  c.log("client", "rules", {
    turn: current.order,
    checkpoints: evaluation.checkpoints.map((m) => m.id),
    violations: evaluation.violations.map((m) => m.id),
    beliefs: evaluation.customerBeliefs.map((m) => m.id),
  });
  const turns = c.state.transcript.turns;
  c.set((s) => ({
    board: s.board
      ? applyEvaluation(s.board, evaluation, (o) => turns.find((t) => t.order === o))
      : s.board,
  }));
}

export function handleMouthEvent(c: RoomController, e: MouthEvent): void {
  if (e.type === "unparsed") return c.log("agent", "unparsed", e);
  if (e.type === "unknown") return c.log("agent", e.eventType, e.payload);
  // reply.audio arrives as 10 ms chunks; only the first chunk of each reply is logged.
  if (e.type !== "reply_audio" || e.firstChunk) {
    c.log(
      e.type === "status" || e.type === "closed" || e.type === "latency" ? "client" : "agent",
      MOUTH_WIRE[e.type] ?? `mouth.${e.type}`,
      e,
    );
  }
  switch (e.type) {
    case "status":
      return c.set((s) => ({
        status: {
          ...s.status,
          mouth: e.status,
          mouthReady: e.status === "open" && s.status.mouthReady,
        },
      }));
    case "ready":
      return c.set((s) => ({
        status: { ...s.status, mouthReady: true, mouthSessionId: e.sessionId },
      }));
    case "error":
      return c.set((s) => ({ status: { ...s.status, mouthError: `${e.code}: ${e.message}` } }));
    case "speech_started":
      c.playback?.flush();
      return;
    case "reply_started":
      return c.set((s) => ({ status: { ...s.status, agentSpeaking: true } }));
    case "reply_audio":
      c.playback?.play(e.data);
      return;
    case "latency":
      return c.set((s) => ({ latenciesMs: [...s.latenciesMs, e.ms] }));
    case "agent_delta":
      return c.set((s) => ({ captions: { ...s.captions, live: s.captions.live + e.delta } }));
    case "agent_final":
      c.set((s) => ({
        captions: { live: "", history: [...s.captions.history.slice(-9), e.text] },
      }));
      // Tell the STT what the agent just said so it has conversational context (trd.md section 4).
      c.ears?.updateConfiguration({ agent_context: e.text.slice(0, 1750) });
      return;
    case "reply_done":
      if (e.status === "interrupted") c.playback?.flush();
      return c.set((s) => ({ status: { ...s.status, agentSpeaking: false } }));
    case "ended":
    case "closed":
      return c.set((s) => ({ status: { ...s.status, mouthReady: false, agentSpeaking: false } }));
    default:
      return;
  }
}
