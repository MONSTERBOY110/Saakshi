import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Analysis } from "@/lib/analyzer/schema";
import { getPack } from "@/lib/rules/load";
import { emptyBoard, type BoardState } from "@/lib/session/board";
import { applyAnalysis } from "@/lib/session/ears-handler";
import { DEFAULT_SETUP } from "@/lib/session/keyterms";
import { transition, type MachineEvent, type Phase } from "@/lib/session/machine";
import type { StoredTurn } from "@/lib/session/transcript";

// The analyzer is advisory (fusion.ts, docs/decisions.md 2026-09-09). When it finishes, its findings
// land on the board as notes for a reviewer with the turn they refer to. They never start an
// interruption, so there is no analyzer latency to anchor: the only spoken intervention path is the
// deterministic one in runRules, whose anchoring is covered by the live latency spec.

const pack = getPack("insurance-ulip-in");

// The truthful sentence the analyzer flagged live on 2026-09-09, one turn after the lock-in was
// disclosed. The rules do not match it.
const TRUTHFUL = "After 5 years you can take the money out.";

function turn(order: number, text: string, endMs: number): StoredTurn {
  return {
    order,
    text,
    final: true,
    formatted: true,
    speakerLabel: "A",
    role: "advisor",
    language: "en",
    startMs: endMs - 3000,
    endMs,
    words: [],
    revised: false,
    pending: false,
  };
}

function makeController(phase: Phase = "OBSERVE") {
  const state = {
    phase,
    setup: DEFAULT_SETUP,
    board: emptyBoard(pack) as BoardState,
    transcript: { turns: [turn(8, TRUTHFUL, 39_000)] },
    intervention: undefined as unknown,
    interventionsLog: [] as unknown[],
    interventionLatenciesMs: [] as number[],
    status: { heartbeat: { audioMs: 40_000, realtimeFactor: 1, wallMs: 42_500 } },
  };
  const logged: Array<{ type: string; payload: unknown }> = [];
  const c = {
    pack,
    state,
    t0: 0,
    audioClockStart: 2_400,
    intervened: new Set<string>(),
    rate: { lastInterventionAt: null as number | null },
    pendingIntervention: null as { key: string; detectedAt: number; sttLagMs?: number } | null,
    ackTimer: null as ReturnType<typeof setTimeout> | null,
    recentAgentSpeech: [] as string[],
    judgeSolo: null,
    lastTurnAt: 0,
    analyzer: null,
    mouth: { setTools: () => true, updateSession: () => true, replyCreate: () => true },
    ears: { forceEndpoint: () => true, updateConfiguration: () => true },
    set(patch: Record<string, unknown> | ((s: typeof state) => Record<string, unknown>)) {
      Object.assign(state, typeof patch === "function" ? patch(state) : patch);
    },
    dispatch(event: MachineEvent) {
      const next = transition(state.phase, event);
      if (!next) return false;
      state.phase = next;
      return true;
    },
    speakExact() {},
    log(_source: string, type: string, payload: unknown) {
      logged.push({ type, payload });
    },
    clearAckTimer() {},
    rebuild() {},
  };
  return { c: c as never as Parameters<typeof applyAnalysis>[0], state, logged };
}

const analysisFlagging: Analysis = {
  violations: [
    {
      id: "withdraw_anytime",
      turn_order: 8,
      quote: TRUTHFUL,
      confidence: 0.95,
      severity: "critical",
      rationale: "says the money can be taken out",
    },
  ],
  checkpoints_satisfied: [],
  customer_questions_unanswered: [],
  language_mix: "en",
};

beforeEach(() => {
  vi.spyOn(performance, "now").mockReturnValue(45_000);
});

describe("the analyzer path is advisory", () => {
  it("never starts an intervention, however confident the model is", () => {
    const { c, state } = makeController();
    applyAnalysis(c, analysisFlagging, 8);
    const pending = (c as unknown as { pendingIntervention: unknown }).pendingIntervention;
    expect(pending).toBeNull();
    expect(state.phase).toBe("OBSERVE");
    expect(state.intervention).toBeUndefined();
    expect(state.board.violations).toEqual([]);
  });

  it("leaves a note on the board with the turn it refers to, and logs it", () => {
    const { c, state, logged } = makeController();
    applyAnalysis(c, analysisFlagging, 8);
    expect(state.board.notes.map((n) => n.key)).toEqual(["prohibited:withdraw_anytime@8"]);
    const note = state.board.notes[0]!;
    expect(note.label).toBe(pack.prohibited.find((p) => p.id === "withdraw_anytime")?.label);
    expect(note.confidence).toBe(0.95);
    expect(note.evidence).toMatchObject({ turnOrder: 8, role: "advisor", quote: TRUTHFUL });
    expect(logged.some((l) => l.type === "analyzer.notes")).toBe(true);
  });

  it("does nothing when the analyzer found nothing worth a note", () => {
    const { c, state } = makeController();
    const quiet: Analysis = { ...analysisFlagging, violations: [] };
    applyAnalysis(c, quiet, 8);
    expect(state.board.notes).toEqual([]);
    expect(state.board.violations).toEqual([]);
  });
});
