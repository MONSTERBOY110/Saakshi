import { createPlayback, type Playback } from "@/lib/audio/playback";
import {
  createSyntheticAdvisor,
  type AdvisorState,
  type SyntheticAdvisor,
} from "@/lib/demo/synthetic-advisor";
import { FRAME_SAMPLES } from "@/lib/audio/worklet";
import type { CompiledPack } from "@/lib/rules/pack";

// Judge-solo mode in the room (prd.md P0-10). A judge on their own hears Rahul from the speakers
// and only has to play Mrs. Sharma. The advisor's frames are queued here; the audio router takes
// one per microphone frame, mixes it into the Ears stream and leaves the Mouth alone.

/** One frame is 50 ms at 24 kHz, so half a second of slack before frames are dropped. */
const MAX_QUEUED_FRAMES = 10;
const FRAME_MS = 50;

export type JudgeSoloState = {
  enabled: boolean;
  status: AdvisorState["status"];
  index: number;
  lineId?: string;
  waitingFor?: string;
};

export type JudgeSolo = {
  /** Handed to the audio router: the next advisor frame to mix, or null. */
  nextFrame(): Int16Array | null;
  start(): void;
  /** A finalized customer turn releases a line that waits for one. */
  customerSpoke(): void;
  /** The operator asked for the next line. */
  advance(): void;
  /** The advisor is speaking, or just finished: this turn is his, and the room knows it. */
  spokeRecently(withinMs?: number): boolean;
  stop(): void;
  state(): JudgeSoloState;
};

export type JudgeSoloDeps = {
  pack: CompiledPack;
  /** The capture context, so the advisor is played through the same clock as everything else. */
  ctx: AudioContext;
  /** True when nobody else is speaking, so a line will not be merged into someone else's turn. */
  canSpeak?: () => boolean;
  onState: (state: JudgeSoloState) => void;
  onLog: (type: string, payload: unknown) => void;
  loadAudio?: (packId: string, lineId: string) => Promise<Int16Array>;
};

export function createJudgeSolo(deps: JudgeSoloDeps): JudgeSolo {
  const queue: Int16Array[] = [];
  // Its own playback, so flushing Saakshi on a barge-in never cuts the advisor mid sentence.
  const speakers: Playback = createPlayback(deps.ctx);
  let dropped = 0;
  let state: JudgeSoloState = { enabled: true, status: "idle", index: -1 };

  const advisor: SyntheticAdvisor = createSyntheticAdvisor({
    script: deps.pack.demo_script,
    loadAudio: (id) => (deps.loadAudio ?? fetchPcm)(deps.pack.id, id),
    frameSamples: FRAME_SAMPLES,
    frameMs: FRAME_MS,
    canSpeak: deps.canSpeak,
    onFrame: (pcm) => {
      // The microphone is the real-time clock. If it falls behind, the oldest advisor audio is
      // dropped rather than allowed to pile up, which would put the two voices out of step and
      // push the Ears stream past real time.
      if (queue.length >= MAX_QUEUED_FRAMES) {
        queue.shift();
        dropped += 1;
        if (dropped % 20 === 1) deps.onLog("judge_solo.frames_dropped", { dropped });
      }
      queue.push(pcm);
      speakers.playPcm(pcm);
    },
    onState: (s) => {
      state = { enabled: true, ...s };
      deps.onLog("judge_solo.line", s);
      deps.onState(state);
    },
  });

  return {
    nextFrame: () => queue.shift() ?? null,
    start() {
      deps.onLog("judge_solo.start", { pack: deps.pack.id, lines: deps.pack.demo_script.length });
      void advisor.start();
    },
    customerSpoke: () => advisor.customerSpoke(),
    advance: () => advisor.advance(),
    spokeRecently: (withinMs) => advisor.spokeRecently(withinMs),
    stop() {
      advisor.stop();
      queue.length = 0;
      speakers.flush();
    },
    state: () => state,
  };
}

/** Raw 24 kHz PCM16 written by scripts/render-advisor.mjs. */
async function fetchPcm(packId: string, lineId: string): Promise<Int16Array> {
  const res = await fetch(`/demo/advisor/${packId}/${lineId}.pcm`, { cache: "force-cache" });
  if (!res.ok) throw new Error(`${lineId} missing (${res.status})`);
  const bytes = await res.arrayBuffer();
  return new Int16Array(bytes);
}
