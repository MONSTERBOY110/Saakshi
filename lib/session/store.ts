import { create } from "zustand";
import type { SocketStatus } from "@/lib/aai/socket";
import type { BoardState } from "./board";
import { DEFAULT_SETUP, type SessionSetup } from "./keyterms";
import type { LogEvent } from "./log";
import type { Phase } from "./machine";
import { initialRoles, type RolesState } from "./roles";
import { emptyTranscript, type TranscriptState } from "./transcript";

// Room state for the UI. The controller (controller.ts) is the only writer.

export type Gap = { fromMs: number; toMs: number; code: number };

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
  latenciesMs: number[];
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
  gaps: [] as Gap[],
  events: [] as LogEvent[],
  error: undefined as string | undefined,
});

export const useRoomStore = create<RoomState>()((set) => ({
  ...initialRoom(),
  setSetup: (patch) => set((s) => ({ setup: { ...s.setup, ...patch } })),
}));
