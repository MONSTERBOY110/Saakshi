import type { Playback } from "@/lib/audio/playback";
import type { LogEvent, LogSource } from "./log";
import type { EarsSocket, MouthSocket, SocketStatus } from "./sockets";

// State, constants and small helpers for the Phase 0 spike page. The Phase 2 state machine and
// audio router replace this module.

export type SpikePhase = "idle" | "starting" | "live" | "stopping" | "stopped" | "error";

export type SpikeState = {
  phase: SpikePhase;
  error?: string;
  micRate: number | null;
  /** Spike toggle for S3. Off = the Voice Agent gets no input.audio at all. */
  micToMouth: boolean;
  frames: { ears: number; mouth: number; droppedBeforeReady: number };
  ears: {
    status: SocketStatus;
    sessionId?: string;
    closeCode?: number;
    heartbeat?: { audioMs: number; realtimeFactor: number; wallMs: number };
  };
  mouth: {
    status: SocketStatus;
    sessionId?: string;
    ready: boolean;
    closeCode?: number;
    lastError?: string;
  };
  captions: { live: string; history: string[] };
  userTranscript: string;
  /** reply.create sent to first reply.audio received, in ms. */
  latenciesMs: number[];
  verbatim: { expected: string; outputs: string[]; matches: number; running: boolean } | null;
  events: LogEvent[];
};

export type Patch = Partial<SpikeState> | ((s: SpikeState) => Partial<SpikeState>);

export type Waiters = {
  terminated?: () => void;
  ended?: () => void;
  agentText?: (t: string) => void;
};

/** What the event handlers and actions need from the controller. */
export interface SpikeHost {
  readonly state: SpikeState;
  readonly t0: number;
  ears: EarsSocket | null;
  mouth: MouthSocket | null;
  playback: Playback | null;
  waiters: Waiters;
  pendingReplyAt: number | null;
  replyAudio: { chunks: number; b64Chars: number };
  set(patch: Patch): void;
  log(source: LogSource, type: string, payload: unknown): void;
}

export const SPIKE_KEYTERMS = [
  "Saakshi",
  "Rahul",
  "Sharma",
  "ULIP",
  "lock-in",
  "free look",
  "surrender value",
  "fund value",
  "premium allocation charge",
];
export const SPIKE_STT_PROMPT =
  "Bank branch conversation. An insurance advisor explains a ULIP to a customer who speaks Hindi and English.";
export const SPIKE_GREETING =
  "I am Saakshi. I will listen quietly and make sure everything important is covered. Please say your name.";
export const VERBATIM_LINE = "Returns on a market-linked plan cannot be called guaranteed.";

export const initialState = (): SpikeState => ({
  phase: "idle",
  micRate: null,
  micToMouth: true,
  frames: { ears: 0, mouth: 0, droppedBeforeReady: 0 },
  ears: { status: "closed" },
  mouth: { status: "closed", ready: false },
  captions: { live: "", history: [] },
  userTranscript: "",
  latenciesMs: [],
  verbatim: null,
  events: [],
});

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return (await res.json()) as T;
}

export function withTimeout<T>(p: Promise<T>, ms: number, fallback?: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback as T), ms);
    p.then((v) => {
      clearTimeout(timer);
      resolve(v);
    });
  });
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
