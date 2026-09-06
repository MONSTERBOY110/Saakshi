import { create } from "zustand";
import type { SocketStatus } from "@/lib/aai/socket";
import type { BoardState } from "./board";
import type { Severity } from "@/lib/rules/pack";
import { DEFAULT_SETUP, type SessionSetup } from "./keyterms";
import type { LogEvent } from "./log";
import type { Phase } from "./machine";
import { initialRoles, type RolesState } from "./roles";
import { emptyTranscript, type TranscriptState } from "./transcript";

// Room state for the UI. The controller (controller.ts) is the only writer.

export type Gap = { fromMs: number; toMs: number; code: number };

export type ActiveIntervention = {
  key: string;
  id: string;
  label: string;
  severity: Severity;
  source: "rules" | "llm";
  spokenText: string;
  quote: string;
  acknowledged: boolean;
  note?: string;
  startedAt: number;
  /** Finalized turn received to first agent audio. */
  latencyMs?: number;
  /** Recogniser lag: end of speech in the audio timeline to the finalized turn arriving. */
  sttLagMs?: number;
  /** What the room experiences: sttLagMs plus latencyMs. */
  totalMs?: number;
};

export type NudgeState = { spokenText: string; missing: string[]; at: number };

export type AnalyzerState = {
  status: "idle" | "running" | "ok" | "error" | "skipped";
  model?: string;
  latencyMs?: number;
  lastError?: string;
  calls: number;
  skipped: number;
};

export type RoomStatus = {
  micRate: number | null;
  ears: SocketStatus;
  earsSessionId?: string;
  heartbeat?: { audioMs: number; realtimeFactor: number; wallMs: number };
  mouth: SocketStatus;
  mouthReady: boolean;
  mouthSessionId?: string;
  mouthError?: string;
  agentSpeaking: boolean;
};

export type RoomState = {
  setup: SessionSetup;
  phase: Phase;
  roles: RolesState;
  transcript: TranscriptState;
  board: BoardState | null;
  captions: { live: string; history: string[] };
  status: RoomStatus;
  /** reply.create to first audio, for any spoken line. */
  latenciesMs: number[];
  /** Violating turn received to first intervention audio. */
  interventionLatenciesMs: number[];
  /** End of the advisor speech to first intervention audio (the number the demo shows). */
  interventionTotalMs: number[];
  intervention?: ActiveIntervention;
  nudge?: NudgeState;
  analyzer: AnalyzerState;
  gaps: Gap[];
  events: LogEvent[];
  error?: string;
  setSetup: (patch: Partial<SessionSetup>) => void;
};

export const initialStatus = (): RoomStatus => ({
  micRate: null,
  ears: "closed",
  mouth: "closed",
  mouthReady: false,
  agentSpeaking: false,
});

export const initialRoom = (setup: SessionSetup = DEFAULT_SETUP) => ({
  setup,
  phase: "SETUP" as Phase,
  roles: initialRoles(),
  transcript: emptyTranscript(),
  board: null,
  captions: { live: "", history: [] as string[] },
  status: initialStatus(),
  latenciesMs: [] as number[],
  interventionLatenciesMs: [] as number[],
  interventionTotalMs: [] as number[],
  intervention: undefined as ActiveIntervention | undefined,
  nudge: undefined as NudgeState | undefined,
  analyzer: { status: "idle", calls: 0, skipped: 0 } as AnalyzerState,
  gaps: [] as Gap[],
  events: [] as LogEvent[],
  error: undefined as string | undefined,
});

export const useRoomStore = create<RoomState>()((set) => ({
  ...initialRoom(),
  setSetup: (patch) => set((s) => ({ setup: { ...s.setup, ...patch } })),
}));
