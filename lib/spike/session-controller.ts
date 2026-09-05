import { AGENT_WS_BASE, buildInitialSession } from "@/lib/aai/agent-config";
import { buildSttUrl } from "@/lib/aai/stt-url";
import { startCapture, type Capture } from "@/lib/audio/capture";
import { createPlayback, type Playback } from "@/lib/audio/playback";
import { CALIBRATE_PROMPT } from "@/lib/prompts";
import { appendEvent, stripAudio, type LogEvent, type LogSource } from "./log";
import { openEars, openMouth, type EarsSocket, type MouthSocket } from "./sockets";
import * as actions from "./spike-actions";
import { handleEars, handleMouth } from "./spike-events";
import {
  fetchJson,
  initialState,
  SPIKE_GREETING,
  SPIKE_KEYTERMS,
  SPIKE_STT_PROMPT,
  withTimeout,
  type Patch,
  type SpikeHost,
  type SpikeState,
  type Waiters,
} from "./spike-state";

export { median, type SpikePhase, type SpikeState } from "./spike-state";

// Phase 0 spike: one mic, both AssemblyAI sockets, an event log, and the controls needed for
// spikes S1-S5 and S8. The Phase 2 state machine and audio router replace the gating here.

type Listener = () => void;

export class SessionController implements SpikeHost {
  state: SpikeState = initialState();
  t0 = 0;
  ears: EarsSocket | null = null;
  mouth: MouthSocket | null = null;
  playback: Playback | null = null;
  waiters: Waiters = {};
  pendingReplyAt: number | null = null;
  replyAudio = { chunks: 0, b64Chars: 0 };

  private readonly listeners = new Set<Listener>();
  private capture: Capture | null = null;
  private seq = 0;
  private counters = { ears: 0, mouth: 0, droppedBeforeReady: 0 };
  private counterTimer: ReturnType<typeof setInterval> | null = null;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = (): SpikeState => this.state;

  // ------------------------------------------------------------------ lifecycle

  async start(): Promise<void> {
    if (this.state.phase === "starting" || this.state.phase === "live") return;
    this.set({ ...initialState(), phase: "starting", micToMouth: this.state.micToMouth });
    this.t0 = performance.now();
    this.seq = 0;
    this.counters = { ears: 0, mouth: 0, droppedBeforeReady: 0 };
    try {
      const [stt, agent] = await Promise.all([
        fetchJson<{ token: string }>("/api/token/stt"),
        fetchJson<{ token: string }>("/api/token/agent"),
      ]);
      this.log("client", "tokens.minted", {
        stt_len: stt.token.length,
        agent_len: agent.token.length,
      });
      const capture = await startCapture((pcm) => this.onFrame(pcm));
      this.capture = capture;
      this.playback = createPlayback(capture.ctx);
      this.set({ micRate: capture.sampleRate });
      this.log("client", "mic.started", {
        sampleRate: capture.sampleRate,
        state: capture.ctx.state,
      });
      this.connectEars(stt.token, capture.sampleRate);
      this.connectMouth(agent.token);
      this.counterTimer = setInterval(() => this.set({ frames: { ...this.counters } }), 1000);
      this.set({ phase: "live" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log("client", "error", { message });
      this.set({ phase: "error", error: message });
      await this.teardown();
    }
  }

  async stop(): Promise<void> {
    if (!["live", "starting", "error"].includes(this.state.phase)) return;
    this.set({ phase: "stopping" });
    const terminated = new Promise<void>((res) => (this.waiters.terminated = res));
    const ended = new Promise<void>((res) => (this.waiters.ended = res));
    // Mic off first so no frame follows the end-of-session messages.
    await this.capture?.stop().catch(() => undefined);
    this.capture = null;
    // Terminate flushes STT (SpeakerRevision arrives right before Termination). session.end closes
    // the agent session at once instead of leaving a billable 30 s resume window.
    if (this.ears?.sendJson({ type: "Terminate" })) this.log("client", "Terminate", {});
    else this.waiters.terminated?.();
    if (this.mouth?.sendJson({ type: "session.end" })) this.log("client", "session.end", {});
    else this.waiters.ended?.();
    await Promise.all([withTimeout(terminated, 6000), withTimeout(ended, 6000)]);
    await this.teardown();
    this.set({ phase: "stopped", frames: { ...this.counters } });
  }

  private async teardown(): Promise<void> {
    if (this.counterTimer) clearInterval(this.counterTimer);
    this.counterTimer = null;
    this.playback?.flush();
    this.playback = null;
    this.ears?.close();
    this.mouth?.close();
    this.ears = null;
    this.mouth = null;
    await this.capture?.stop().catch(() => undefined);
    this.capture = null;
  }

  // ------------------------------------------------------------------ spike controls

  setMicToMouth(on: boolean): void {
    this.set({ micToMouth: on });
    this.log("client", "mic_to_mouth", { on });
  }
  replyNow = (instructions: string): void => actions.replyNow(this, instructions);
  injectFact = (content: string): void => actions.injectFact(this, content);
  forceEndpoint = (): void => actions.forceEndpoint(this);
  updateKeyterms = (terms: string[]): void => actions.updateKeyterms(this, terms);
  verbatimTrial = (n: number): Promise<void> => actions.verbatimTrial(this, n);
  exportFixtures = (): void => actions.exportFixtures(this);

  // ------------------------------------------------------------------ sockets

  private connectEars(token: string, sampleRate: number): void {
    const url = buildSttUrl({
      token,
      sampleRate,
      keyterms: SPIKE_KEYTERMS,
      languageCodes: ["en", "hi"],
      prompt: SPIKE_STT_PROMPT,
    });
    this.log("client", "ears.connect", { url: url.replace(/token=[^&]+/, "token=<redacted>") });
    this.set((s) => ({ ears: { ...s.ears, status: "connecting" } }));
    this.ears = openEars(url, {
      onOpen: () => {
        this.set((s) => ({ ears: { ...s.ears, status: "open" } }));
        this.log("client", "ears.open", {});
      },
      onMessage: (msg) => handleEars(this, msg),
      onClose: (code, reason) => {
        this.set((s) => ({ ears: { ...s.ears, status: "closed", closeCode: code } }));
        this.log("client", "ears.close", { code, reason });
        this.waiters.terminated?.();
      },
      onError: () => this.log("client", "ears.error", {}),
    });
  }

  private connectMouth(token: string): void {
    const url = `${AGENT_WS_BASE}?token=${encodeURIComponent(token)}`;
    this.log("client", "mouth.connect", { url: `${AGENT_WS_BASE}?token=<redacted>` });
    this.set((s) => ({ mouth: { ...s.mouth, status: "connecting" } }));
    this.mouth = openMouth(url, {
      onOpen: () => {
        this.set((s) => ({ mouth: { ...s.mouth, status: "open" } }));
        const update = buildInitialSession({
          systemPrompt: CALIBRATE_PROMPT,
          greeting: SPIKE_GREETING,
          keyterms: SPIKE_KEYTERMS,
          languageCodes: ["en", "hi"],
        });
        this.mouth?.sendJson(
          update as unknown as { type: "session.update"; session: Record<string, unknown> },
        );
        this.log("client", "session.update", update);
      },
      onMessage: (ev) => handleMouth(this, ev),
      onClose: (code, reason) => {
        this.set((s) => ({
          mouth: { ...s.mouth, status: "closed", ready: false, closeCode: code },
        }));
        this.log("client", "mouth.close", { code, reason });
        this.waiters.ended?.();
      },
      onError: () => this.log("client", "mouth.error", {}),
    });
  }

  private onFrame(pcm: Int16Array): void {
    if (this.ears?.sendAudio(pcm)) this.counters.ears += 1;
    if (!this.state.micToMouth) return;
    if (!this.state.mouth.ready) {
      this.counters.droppedBeforeReady += 1;
      return;
    }
    if (this.mouth?.sendAudio(pcm)) this.counters.mouth += 1;
  }

  // ------------------------------------------------------------------ state + log

  set(patch: Patch): void {
    const p = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

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
}
