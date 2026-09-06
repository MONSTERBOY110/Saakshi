import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Analysis } from "@/lib/analyzer/schema";
import { getPack } from "@/lib/rules/load";
import { emptyBoard } from "@/lib/session/board";
import { applyAnalysis } from "@/lib/session/ears-handler";
import { DEFAULT_SETUP } from "@/lib/session/keyterms";
import { transition, type MachineEvent, type Phase } from "@/lib/session/machine";
import type { StoredTurn } from "@/lib/session/transcript";

// The badge on screen means "end of the advisor's speech to Saakshi's first sound". Two things can
// start an interruption: the deterministic rules, and the LLM analyzer when it finishes. Both must
// anchor the measurement to the audio timeline, or the room reports the flattering half.

const pack = getPack("insurance-ulip-in");

const CLAIM = "Anytime, madam, and the returns are guaranteed, 12%.";

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
    board: emptyBoard(pack),
    transcript: { turns: [turn(8, CLAIM, 39_000)] },
    intervention: undefined as unknown,
    interventionsLog: [] as unknown[],
    interventionLatenciesMs: [] as number[],
    // A heartbeat that puts audio-timeline zero 2.5 s after the room started.
    status: { heartbeat: { audioMs: 40_000, realtimeFactor: 1, wallMs: 42_500 } },
  };
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
    log() {},
    clearAckTimer() {},
    rebuild() {},
  };
  return { c: c as never as Parameters<typeof applyAnalysis>[0], state };
}

const analysisFlagging: Analysis = {
  violations: [
    {
      id: "guaranteed_returns",
      turn_order: 8,
      quote: "the returns are guaranteed, 12%",
      confidence: 0.95,
      severity: "critical",
      rationale: "a market linked plan cannot promise a return",
    },
  ],
  checkpoints_satisfied: [],
  customer_questions_unanswered: [],
  language_mix: "en",
};

beforeEach(() => {
  // 45 s after the room started: six seconds after the claim ended on the audio timeline.
  vi.spyOn(performance, "now").mockReturnValue(45_000);
});

describe("the analyzer path anchors its measurement to the audio timeline", () => {
  it("supplies the recogniser lag, so the badge can show an end-to-end total", () => {
    const { c } = makeController();
    applyAnalysis(c, analysisFlagging, 8);
    const pending = (c as unknown as { pendingIntervention: { sttLagMs?: number } | null })
      .pendingIntervention;
    expect(pending, "an intervention should have started").not.toBeNull();
    // Audio-timeline zero sits at 2.5 s; the claim ended at 39 s of audio, so 41.5 s on the room
    // clock. The analyzer decided at 45 s, which is 3.5 s of recogniser and analyzer wait.
    expect(pending?.sttLagMs).toBeDefined();
    expect(pending?.sttLagMs).toBeCloseTo(3_500, -2);
  });

  it("measures from when the room could first have known, not from when it looked", () => {
    const { c } = makeController();
    applyAnalysis(c, analysisFlagging, 8);
    const pending = (c as unknown as { pendingIntervention: { detectedAt: number } | null })
      .pendingIntervention;
    expect(pending?.detectedAt).toBe(45_000);
  });
});
