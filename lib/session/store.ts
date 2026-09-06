import { create } from "zustand";
import type { TeachbackQuestion } from "@/lib/teachback/questions";
import type { JudgeSoloState } from "./judge-solo";
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

export type TeachbackVerdict = "understood" | "partial" | "not_understood";

// One definition of a teach-back question, shared by the generator, the room and the certificate.
export type { TeachbackQuestion } from "@/lib/teachback/questions";

export type TeachbackAnswer = {
  questionId: string;
  question: string;
  topic: string;
  verdict: TeachbackVerdict;
  customerQuote: string;
  turnOrder?: number;
  evidence?: {
    turn_order: number;
    speaker_role: "advisor" | "customer";
    start_ms: number;
    end_ms: number;
    quote: string;
    language: string;
  };
  reexplained: boolean;
};

export type TeachbackState = {
  /** loading: waiting for questions. asking: in the question loop. finishing: writing the
   *  certificate while the agent holds. done: the agent has said its closing line. */
  status: "loading" | "asking" | "finishing" | "done";
  source: "llm" | "pack" | "mixed";
  questions: TeachbackQuestion[];
  answers: TeachbackAnswer[];
  /** Question ids Saakshi has already explained a second time; each is allowed once. */
  reexplained: string[];
  /** Times the advisor answered for the customer and was asked to let her speak. */
  advisorInterjections: number;
  /** True once finish_teachback has been revealed to the agent (after three answers). */
  finishOffered: boolean;
  summary?: string;
  model?: string;
  error?: string;
};

export type CertificateState = {
  status: "building" | "stored" | "error";
  id?: string;
  hash?: string;
  url?: string;
  error?: string;
};

export type InterventionRecord = {
  key: string;
  spokenText: string;
  latencyMs?: number;
  acknowledged: boolean;
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
  /** Every intervention this session, in order, for the certificate. */
  interventionsLog: InterventionRecord[];
  nudge?: NudgeState;
  teachback?: TeachbackState;
  judgeSolo?: JudgeSoloState;
  certificate?: CertificateState;
  /** ISO time the session started, for the certificate. */
  startedAt?: string;
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
  interventionsLog: [] as InterventionRecord[],
  nudge: undefined as NudgeState | undefined,
  teachback: undefined as TeachbackState | undefined,
  judgeSolo: undefined as JudgeSoloState | undefined,
  certificate: undefined as CertificateState | undefined,
  startedAt: undefined as string | undefined,
  analyzer: { status: "idle", calls: 0, skipped: 0 } as AnalyzerState,
  gaps: [] as Gap[],
  events: [] as LogEvent[],
  error: undefined as string | undefined,
});

export const useRoomStore = create<RoomState>()((set) => ({
  ...initialRoom(),
  setSetup: (patch) => set((s) => ({ setup: { ...s.setup, ...patch } })),
}));
