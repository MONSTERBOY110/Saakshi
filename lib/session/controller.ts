import type { AnalyzeRequest, AnalyzeResponse } from "@/lib/analyzer/schema";
import { startCapture, type Capture } from "@/lib/audio/capture";
import { createPlayback, type Playback } from "@/lib/audio/playback";
import { buildObserverPrompt } from "@/lib/prompts/observer";
import type { Role } from "@/lib/rules/engine";
import { getPack } from "@/lib/rules/load";
import type { CompiledPack } from "@/lib/rules/pack";
import type { Ears } from "@/lib/aai/ears";
import type { Mouth } from "@/lib/aai/mouth";
import type { AnalyzerClient } from "@/lib/analyzer/client";
import type { Router } from "@/lib/audio/router";
import { emptyBoard, rebuildBoard } from "./board";
import { applyAnalysis } from "./ears-handler";
import { certifySession } from "./certify";
import { createJudgeSolo, type JudgeSolo } from "./judge-solo";
import { acknowledgeIntervention, startNudge } from "./flows";
import type { RateLimitState } from "./fusion";
import { buildCalibrationLine, type SessionSetup } from "./keyterms";
import { appendEvent, stripAudio, type LogEvent, type LogSource } from "./log";
import { transition, type MachineEvent } from "./machine";
import { roleOfLabel, rolesBound } from "./roles";
import { addKeyterms, assignRoleTo, exportFixtures, swapRoleAssignment } from "./room-actions";
import { initialRoom, useRoomStore, type RoomState } from "./store";
import { ToolResultQueue } from "./tool-results";
import { finishTeachback, startTeachback } from "./teachback";
import { buildAnalyzerClient, buildEars, buildMouth, buildRouter } from "./wiring";
import { finalTurns } from "./transcript";

// Orchestrates one Saakshi session: mic capture and routing, the Ears and Mouth clients,
// calibration, the rule engine, the LLM analyzer, interventions and the nudge. Writes to the
// Zustand store; the UI only reads.

export class RoomController {
  pack: CompiledPack | null = null;
  ears: Ears | null = null;
  mouth: Mouth | null = null;
  playback: Playback | null = null;
  analyzer: AnalyzerClient | null = null;
  judgeSolo: JudgeSolo | null = null;
  t0 = 0;
  /** Keys `${id}@${turnOrder}` Saakshi has already spoken about. */
  readonly intervened = new Set<string>();
  rate: RateLimitState = { lastInterventionAt: null };
  pendingIntervention: { key: string; detectedAt: number; sttLagMs?: number } | null = null;
  ackTimer: ReturnType<typeof setTimeout> | null = null;
  /** The last few lines Saakshi said, for the echo guard. */
  readonly recentAgentSpeech: string[] = [];
  /** performance.now() of the last Turn from the Ears, partial or final: the room is noisy. */
  lastTurnAt = 0;
  /** performance.now() when the first mic frame reached the Ears; turn timings are audio-relative. */
  audioClockStart: number | null = null;
  /** performance.now() of the last time the advisor was asked to let the customer answer. */
  lastAdvisorGuardAt: number | null = null;
  /** Tool results wait for reply.done, as the client-side-tools docs require. */
  readonly toolResults = new ToolResultQueue();

  private capture: Capture | null = null;
  private router: Router | null = null;
  private seq = 0;
  private stopping = false;

  get state(): RoomState {
    return useRoomStore.getState();
  }

  set(patch: Partial<RoomState> | ((s: RoomState) => Partial<RoomState>)): void {
    useRoomStore.setState(patch);
  }

  // ------------------------------------------------------------------ lifecycle

  async start(setup: SessionSetup): Promise<void> {
    if (this.state.phase !== "SETUP") return;
    const pack = getPack(setup.packId);
    this.pack = pack;
    this.t0 = performance.now();
    this.seq = 0;
    this.stopping = false;
    this.intervened.clear();
    this.rate = { lastInterventionAt: null };
    this.recentAgentSpeech.length = 0;
    this.audioClockStart = null;
    this.lastTurnAt = 0;
    this.lastAdvisorGuardAt = null;
    this.toolResults.reset();
    this.set({
      ...initialRoom(setup),
      board: emptyBoard(pack),
      phase: "CALIBRATE",
      startedAt: new Date().toISOString(),
    });
    try {
      const capture = await startCapture((pcm) => this.router?.push(pcm));
      this.capture = capture;
      this.playback = createPlayback(capture.ctx);
      this.router = buildRouter(this);
      this.set((s) => ({ status: { ...s.status, micRate: capture.sampleRate } }));
      this.log("client", "mic.started", { sampleRate: capture.sampleRate });

      if (setup.judgeSolo) {
        this.judgeSolo = createJudgeSolo({
          pack,
          ctx: capture.ctx,
          canSpeak: () => this.roomIsQuiet(),
          onState: (judgeSolo) => this.set({ judgeSolo }),
          onLog: (type, payload) => this.log("client", type, payload),
        });
        this.set({ judgeSolo: this.judgeSolo.state() });
      }
      this.analyzer = buildAnalyzerClient(this);
      this.ears = buildEars(this, setup, pack, capture.sampleRate);
      this.mouth = buildMouth(this, setup, pack);
      await Promise.all([this.ears.connect(), this.mouth.connect()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log("client", "error", { message });
      this.set({ error: message });
      await this.teardown();
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    // ABORT is legal from CALIBRATE, OBSERVE and TEACHBACK (trd.md section 2). From the other
    // phases the operator's Stop is a hard end, so the final DONE below is set outright.
    this.dispatch({ type: "ABORT" });
    await this.capture?.stop().catch(() => undefined);
    this.capture = null;
    await Promise.all([this.ears?.terminate(6000), this.mouth?.end(6000)]);
    await this.teardown();
    this.set({ phase: "DONE" });
  }

  /** Back to the setup form after a finished session. */
  reset(): void {
    this.set({ ...initialRoom(this.state.setup) });
  }

  private async teardown(): Promise<void> {
    this.clearAckTimer();
    this.judgeSolo?.stop();
    this.judgeSolo = null;
    this.analyzer?.dispose();
    this.analyzer = null;
    this.playback?.flush();
    this.playback = null;
    this.ears?.close();
    this.mouth?.close();
    this.ears = null;
    this.mouth = null;
    this.router = null;
    await this.capture?.stop().catch(() => undefined);
    this.capture = null;
  }

  // ------------------------------------------------------------------ room actions

  dispatch(event: MachineEvent): boolean {
    const next = transition(this.state.phase, event);
    if (!next) return false;
    this.log("client", "phase", { from: this.state.phase, to: next, event: event.type });
    this.set({ phase: next });
    return true;
  }

  swapRoles = (): void => swapRoleAssignment(this);
  assignRole = (role: Role, label: string): void => assignRoleTo(this, role, label);
  addKeyterms = (terms: string[]): void => addKeyterms(this, terms);
  exportFixtures = (): void => exportFixtures(this);

  /** Called when calibration binds a role; speaks the next prompt and swaps to the observer prompt. */
  onRolesChanged(): void {
    const { roles, setup, phase } = this.state;
    if (phase !== "CALIBRATE") return;
    if (rolesBound(roles)) {
      this.speakExact(buildCalibrationLine(setup, "done"));
      this.mouth?.updateSession({
        system_prompt: buildObserverPrompt({
          advisor: setup.advisorName,
          customer: setup.customerName,
        }),
      });
      this.dispatch({ type: "ROLES_BOUND" });
    } else if (roles.advisor && !roles.customer) {
      this.speakExact(buildCalibrationLine(setup, "customer"));
    }
  }

  verify(trigger: "spoken" | "button", turnOrder?: number): void {
    const lastOrder = turnOrder ?? finalTurns(this.state.transcript).at(-1)?.order ?? 0;
    startNudge(this, trigger, lastOrder);
  }

  acknowledge(note = "acknowledged in the room"): void {
    acknowledgeIntervention(this, note, false);
  }

  /** NUDGE to TEACHBACK: load the questions, swap the prompt and hand the room to the agent. */
  teachback = (): Promise<void> => startTeachback(this);

  /** CERTIFY: build the certificate, store it, and release the held finish_teachback tool. */
  certify = (callId: string | null): Promise<void> => certifySession(this, callId);

  /**
   * Nobody else is talking. The synthetic advisor uses this to avoid speaking over the judge:
   * two voices in one turn cannot be diarized apart, and calibration then binds nobody.
   */
  roomIsQuiet(quietMs = 1200): boolean {
    if (this.state.status.agentSpeaking) return false;
    return performance.now() - this.lastTurnAt > quietMs;
  }

  /** Judge-solo: the operator asks the synthetic advisor for his next line. */
  nextDemoLine = (): void => this.judgeSolo?.advance();

  /** The operator ends the teach-back from the room, without waiting for the agent to decide. */
  finishTeachback = (): void => {
    finishTeachback(this, "The teach-back was ended from the room.", null);
  };

  /** Every spoken line is scripted here; the agent repeats it verbatim (spike S5: 10/10). */
  speakExact(text: string): void {
    if (!this.mouth?.replyCreate(`Say exactly this and nothing else: ${text}`)) return;
    this.log("client", "reply.create", { text });
    this.recentAgentSpeech.push(text);
    if (this.recentAgentSpeech.length > 6) this.recentAgentSpeech.shift();
  }

  rebuild(): void {
    if (!this.pack) return;
    const pack = this.pack;
    this.set((s) => ({
      board: rebuildBoard(pack, finalTurns(s.transcript), s.board ?? undefined),
    }));
  }

  clearAckTimer(): void {
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
  }

  roleOf = (label: string | undefined): Role | undefined => roleOfLabel(this.state.roles, label);

  log(source: LogSource, type: string, payload: unknown): void {
    const event: LogEvent = {
      id: ++this.seq,
      t: Math.round(performance.now() - this.t0),
      source,
      type,
      payload: stripAudio(payload),
    };
    this.set((s) => ({ events: appendEvent(s.events, event) }));
  }

  // ------------------------------------------------------------------ internals

  /** Called by the analyzer client (see wiring.ts) when a completed analysis arrives. */
  onAnalysis(result: AnalyzeResponse, request: AnalyzeRequest): void {
    this.log("client", "analyze.result", {
      model: result.model,
      latency_ms: result.latency_ms,
      request_id: result.request_id,
      violations: result.analysis.violations.map((v) => `${v.id}@${v.turn_order}:${v.confidence}`),
      checkpoints: result.analysis.checkpoints_satisfied.map((c) => `${c.id}@${c.turn_order}`),
    });
    this.set((s) => ({
      analyzer: {
        ...s.analyzer,
        status: "ok",
        model: result.model,
        latencyMs: result.latency_ms,
        calls: s.analyzer.calls + 1,
      },
    }));
    const lastOrder = request.turns.at(-1)?.order;
    // Re-run fusion for the newest turn with the analysis in hand.
    if (lastOrder !== undefined) applyAnalysis(this, result.analysis, lastOrder);
  }
}

let singleton: RoomController | null = null;
export function getRoomController(): RoomController {
  if (!singleton) singleton = new RoomController();
  return singleton;
}
