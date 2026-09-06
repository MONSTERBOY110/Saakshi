import { createFrameReader } from "@/lib/audio/mixer";
import type { DemoLine } from "@/lib/rules/pack";

// Judge-solo mode (prd.md P0-10, trd.md section 8). A pre-rendered Rahul reads the pack's demo
// script so a judge on their own only has to play Mrs. Sharma. Frames leave here at real time,
// because Streaming STT closes the socket with 3007 on audio sent faster than that, and because a
// human has to be able to answer between lines.

/** How long a customer_turn wait holds before the script moves on by itself. */
export const CUSTOMER_TURN_TIMEOUT_MS = 15_000;

/** How long the advisor holds a line back waiting for the room to fall quiet, before going anyway. */
export const QUIET_WAIT_TIMEOUT_MS = 8_000;
const QUIET_POLL_MS = 250;

export type AdvisorStatus = "idle" | "speaking" | "waiting" | "done";

export type AdvisorState = {
  status: AdvisorStatus;
  /** Index into the script of the line being spoken or just spoken. */
  index: number;
  lineId?: string;
  /** The wait_for the script is sitting on, when the status is waiting. */
  waitingFor?: string;
};

export type SyntheticAdvisorDeps = {
  script: DemoLine[];
  /** PCM for one line, 24 kHz mono Int16, from public/demo/advisor/<id>.pcm. */
  loadAudio: (id: string) => Promise<Int16Array>;
  frameSamples: number;
  frameMs: number;
  /**
   * True when nobody else is speaking. A synthetic advisor who talks over the judge produces one
   * merged turn, which diarization cannot split and calibration cannot bind, so lines wait for a
   * gap. It is a hint, not a lock: after QUIET_WAIT_TIMEOUT_MS the line goes out regardless.
   */
  canSpeak?: () => boolean;
  /** Called for every frame: the room mixes it into the Ears stream and plays it aloud. */
  onFrame: (pcm: Int16Array) => void;
  onState: (state: AdvisorState) => void;
};

export type SyntheticAdvisor = {
  start(): Promise<void>;
  /** A customer turn was finalized, which releases a customer_turn wait. */
  customerSpoke(): void;
  /** The operator asked for the next line, which releases or skips whatever wait is running. */
  advance(): void;
  /**
   * The advisor is speaking, or stopped within withinMs. In judge-solo the room played this voice
   * itself, so this is ground truth about who a turn belongs to, not a guess from diarization.
   */
  spokeRecently(withinMs?: number): boolean;
  stop(): void;
  state(): AdvisorState;
};

export function createSyntheticAdvisor(
  deps: SyntheticAdvisorDeps,
  now: () => number = () => Date.now(),
): SyntheticAdvisor {
  let state: AdvisorState = { status: "idle", index: -1 };
  let speaking = false;
  let lastSpokeAt: number | null = null;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let release: (() => void) | null = null;

  const setState = (next: AdvisorState) => {
    state = next;
    deps.onState(next);
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  /** Resolves after ms, or as soon as something calls the release. */
  const waitFor = (ms: number | null) =>
    new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimer();
        release = null;
        resolve();
      };
      release = finish;
      if (ms !== null) timer = setTimeout(finish, ms);
    });

  /** Hold until the room is quiet, or until waiting longer would stall the demo. */
  async function waitForQuiet(): Promise<void> {
    if (!deps.canSpeak) return;
    for (let waited = 0; waited < QUIET_WAIT_TIMEOUT_MS; waited += QUIET_POLL_MS) {
      if (!running || deps.canSpeak()) return;
      await waitFor(QUIET_POLL_MS);
    }
  }

  /** True when the line was actually heard in the room. */
  async function speak(line: DemoLine): Promise<boolean> {
    let pcm: Int16Array;
    try {
      pcm = await deps.loadAudio(line.id);
    } catch {
      // A line nobody rendered is a missing file, not a reason to abandon the demo.
      return false;
    }
    if (!running) return false;
    await waitForQuiet();
    if (!running) return false;
    const reader = createFrameReader(pcm, deps.frameSamples);
    speaking = true;
    try {
      for (let frame = reader.next(); frame !== null; frame = reader.next()) {
        if (!running) return false;
        deps.onFrame(frame);
        if (!reader.done()) await waitFor(deps.frameMs);
      }
    } finally {
      speaking = false;
      lastSpokeAt = now();
    }
    return true;
  }

  function pauseFor(line: DemoLine): Promise<void> {
    if (line.wait_for === "click") return waitFor(null);
    // A customer who says nothing must not freeze the room in front of a judge.
    if (line.wait_for === "customer_turn") return waitFor(CUSTOMER_TURN_TIMEOUT_MS);
    const ms = Number(line.wait_for.slice(3));
    return waitFor(Number.isFinite(ms) ? ms : 0);
  }

  return {
    async start() {
      if (running) return;
      running = true;
      for (const [index, line] of deps.script.entries()) {
        if (!running) return;
        setState({ status: "speaking", index, lineId: line.id });
        const spoke = await speak(line);
        if (!running) return;
        // Nothing was heard, so there is nothing for the customer to answer: go straight on.
        if (!spoke) continue;
        setState({ status: "waiting", index, lineId: line.id, waitingFor: line.wait_for });
        await pauseFor(line);
      }
      if (!running) return;
      running = false;
      setState({ status: "done", index: deps.script.length });
    },
    customerSpoke() {
      if (state.status === "waiting" && state.waitingFor === "customer_turn") release?.();
    },
    advance() {
      release?.();
    },
    spokeRecently(withinMs = 2500) {
      if (speaking) return true;
      return lastSpokeAt !== null && now() - lastSpokeAt <= withinMs;
    },
    stop() {
      running = false;
      clearTimer();
      release?.();
      release = null;
      setState({ status: "idle", index: state.index });
    },
    state: () => state,
  };
}
