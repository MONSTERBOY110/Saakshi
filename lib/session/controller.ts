import { buildInitialSession } from "@/lib/aai/agent-config";
import { Ears } from "@/lib/aai/ears";
import { Mouth } from "@/lib/aai/mouth";
import { startCapture, type Capture } from "@/lib/audio/capture";
import { createPlayback, type Playback } from "@/lib/audio/playback";
import { CALIBRATE_PROMPT } from "@/lib/prompts";
import type { Role } from "@/lib/rules/engine";
import { getPack } from "@/lib/rules/load";
import type { CompiledPack } from "@/lib/rules/pack";
import { emptyBoard, rebuildBoard } from "./board";
import { handleEarsEvent, handleMouthEvent } from "./controller-handlers";
import {
  buildCalibrationLine,
  buildGreeting,
  buildKeyterms,
  buildSttPrompt,
  type SessionSetup,
} from "./keyterms";
import { appendEvent, fixtureExport, stripAudio, type LogEvent, type LogSource } from "./log";
import { audioGates, transition, type MachineEvent } from "./machine";
import { assignRole, roleOfLabel, rolesBound, swapRoles } from "./roles";
import { initialRoom, useRoomStore, type RoomState } from "./store";
import { finalTurns, reassignRoles } from "./transcript";

// Orchestrates one Saakshi session: mic capture, the Ears and Mouth clients, calibration, the
// rule engine and the board. Writes to the Zustand store; the UI only reads.

export class RoomController {
  pack: CompiledPack | null = null;
  ears: Ears | null = null;
  mouth: Mouth | null = null;
  playback: Playback | null = null;
  t0 = 0;
  private capture: Capture | null = null;
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
    this.set({ ...initialRoom(setup), board: emptyBoard(pack), phase: "CALIBRATE" });
    const keyterms = buildKeyterms(setup, pack);
    try {
      const capture = await startCapture((pcm) => this.onFrame(pcm));
      this.capture = capture;
      this.playback = createPlayback(capture.ctx);
      this.set((s) => ({ status: { ...s.status, micRate: capture.sampleRate } }));
      this.log("client", "mic.started", { sampleRate: capture.sampleRate });

      this.ears = new Ears({
        mintToken: () => mintToken("/api/token/stt"),
        config: {
          sampleRate: capture.sampleRate,
          keyterms,
          prompt: buildSttPrompt(setup, pack),
          languageCodes: ["en", "hi"],
        },
        onEvent: (e) => handleEarsEvent(this, e),
      });
      this.mouth = new Mouth({
        mintToken: () => mintToken("/api/token/agent"),
        session: buildInitialSession({
          systemPrompt: CALIBRATE_PROMPT,
          greeting: buildGreeting(setup),
          keyterms,
          languageCodes: ["en", "hi"],
        }).session,
        onEvent: (e) => handleMouthEvent(this, e),
      });
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
    this.playback?.flush();
    this.playback = null;
    this.ears?.close();
    this.mouth?.close();
    this.ears = null;
    this.mouth = null;
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

  swapRoles(): void {
    this.applyRoles(swapRoles(this.state.roles), "swap");
  }

  assignRole(role: Role, label: string): void {
    this.applyRoles(assignRole(this.state.roles, role, label), `assign ${role}=${label}`);
  }

  /** Called by the handlers when calibration binds a role; speaks the next prompt. */
  onRolesChanged(): void {
    const { roles, setup, phase } = this.state;
    if (phase !== "CALIBRATE") return;
    if (rolesBound(roles)) {
      this.speak(buildCalibrationLine(setup, "done"));
      this.dispatch({ type: "ROLES_BOUND" });
    } else if (roles.advisor && !roles.customer) {
      this.speak(buildCalibrationLine(setup, "customer"));
    }
  }

  addKeyterms(terms: string[]): void {
    if (!this.pack) return;
    const setup = {
      ...this.state.setup,
      productTerms: [...this.state.setup.productTerms, ...terms],
    };
    const keyterms = buildKeyterms(setup, this.pack);
    this.set({ setup });
    if (this.ears?.updateConfiguration({ keyterms_prompt: keyterms })) {
      this.log("client", "UpdateConfiguration", { keyterms_prompt: keyterms });
    }
    if (this.mouth?.updateSession({ input: { keyterms } })) {
      this.log("client", "session.update", { input: { keyterms } });
    }
  }

  speak(text: string): void {
    if (this.mouth?.replyCreate(`Say exactly this and nothing else: ${text}`)) {
      this.log("client", "reply.create", { text });
    }
  }

  rebuild(): void {
    if (!this.pack) return;
    this.set({ board: rebuildBoard(this.pack, finalTurns(this.state.transcript)) });
  }

  roleOf = (label: string | undefined): Role | undefined => roleOfLabel(this.state.roles, label);

  exportFixtures(): void {
    const blob = new Blob([JSON.stringify(fixtureExport(this.state.events), null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `saakshi-fixtures-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
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

  // ------------------------------------------------------------------ internals

  private applyRoles(roles: RoomState["roles"], why: string): void {
    this.log("client", "roles", { why, advisor: roles.advisor, customer: roles.customer });
    this.set({ roles });
    this.set((s) => ({ transcript: reassignRoles(s.transcript, this.roleOf) }));
    this.rebuild();
    this.onRolesChanged();
  }

  private onFrame(pcm: Int16Array): void {
    const gates = audioGates(this.state.phase);
    if (gates.micToEars) this.ears?.sendAudio(pcm);
    if (gates.micToMouth) this.mouth?.sendAudio(pcm);
  }
}

async function mintToken(path: string): Promise<string> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

let singleton: RoomController | null = null;
export function getRoomController(): RoomController {
  if (!singleton) singleton = new RoomController();
  return singleton;
}
