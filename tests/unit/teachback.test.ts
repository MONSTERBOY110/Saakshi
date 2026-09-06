import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPack } from "@/lib/rules/load";
import { emptyBoard } from "@/lib/session/board";
import { DEFAULT_SETUP } from "@/lib/session/keyterms";
import { transition, type MachineEvent, type Phase } from "@/lib/session/machine";
import {
  ADVISOR_GUARD_COOLDOWN_MS,
  FINISH_AFTER_ANSWERS,
  finishTeachback,
  guardAdvisorAnswer,
  markReexplained,
  recordAnswer,
  startTeachback,
} from "@/lib/session/teachback";
import type { StoredTurn } from "@/lib/session/transcript";

const pack = getPack("insurance-ulip-in");

const QUESTIONS = [
  {
    id: "q1",
    topic: "market_risk",
    question: "What happens if the market falls?",
    expectedPoints: ["value falls"],
    hintHi: "Market gire to?",
    source: "llm" as const,
  },
  {
    id: "q2",
    topic: "lock_in",
    question: "For how long is your money locked in?",
    expectedPoints: ["five years"],
    source: "pack" as const,
  },
  {
    id: "q3",
    topic: "charges",
    question: "What charges come out of your premium?",
    expectedPoints: ["allocation"],
    source: "pack" as const,
  },
  {
    id: "q4",
    topic: "free_look",
    question: "How long do you have to change your mind?",
    expectedPoints: ["thirty days"],
    source: "pack" as const,
  },
];

function customerTurn(order: number, text: string): StoredTurn {
  return {
    order,
    text,
    final: true,
    formatted: true,
    speakerLabel: "B",
    role: "customer",
    language: "hi",
    startMs: order * 1000,
    endMs: order * 1000 + 900,
    words: [],
    revised: false,
    pending: false,
  };
}

function makeController(phase: Phase = "NUDGE") {
  const spoken: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const replies: string[] = [];
  const logs: Array<{ type: string; payload: unknown }> = [];
  const certified: Array<string | null> = [];
  const state = {
    phase,
    setup: DEFAULT_SETUP,
    board: emptyBoard(pack),
    transcript: { turns: [] as StoredTurn[] },
    teachback: undefined as unknown,
  };
  const c = {
    pack,
    state,
    lastAdvisorGuardAt: null as number | null,
    recentAgentSpeech: [] as string[],
    mouth: {
      updateSession(session: Record<string, unknown>) {
        updates.push(session);
        return true;
      },
      replyCreate(instructions: string) {
        replies.push(instructions);
        return true;
      },
    },
    set(patch: Record<string, unknown> | ((s: typeof state) => Record<string, unknown>)) {
      Object.assign(state, typeof patch === "function" ? patch(state) : patch);
    },
    dispatch(event: MachineEvent) {
      const next = transition(state.phase, event);
      if (!next) return false;
      state.phase = next;
      return true;
    },
    speakExact(text: string) {
      spoken.push(text);
    },
    log(_source: string, type: string, payload: unknown) {
      logs.push({ type, payload });
    },
    certify(callId: string | null) {
      certified.push(callId);
      return Promise.resolve();
    },
  };
  return {
    c: c as never as Parameters<typeof recordAnswer>[0],
    state,
    spoken,
    updates,
    replies,
    logs,
    certified,
  };
}

function stubQuestions(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => (ok ? Response.json(body) : new Response("no", { status: 500 }))),
  );
}

/** Put a controller straight into the asking state without going through the network. */
function asking(questions = QUESTIONS) {
  const h = makeController("TEACHBACK");
  h.state.teachback = {
    status: "asking",
    source: "llm",
    questions,
    answers: [],
    reexplained: [],
    advisorInterjections: 0,
    finishOffered: false,
  };
  return h;
}

afterEach(() => vi.unstubAllGlobals());

describe("startTeachback", () => {
  beforeEach(() =>
    stubQuestions({ questions: QUESTIONS, source: "llm", model: "m", latency_ms: 12 }),
  );

  it("moves NUDGE to TEACHBACK, swaps the prompt and tools, and hands over out loud", async () => {
    const { c, state, updates, replies } = makeController("NUDGE");
    await startTeachback(c);

    expect(state.phase).toBe("TEACHBACK");
    const tb = state.teachback as { status: string; questions: unknown[]; source: string };
    expect(tb.status).toBe("asking");
    expect(tb.questions).toHaveLength(4);
    expect(tb.source).toBe("llm");

    const withTools = updates.find((u) => "tools" in u) as {
      tools: Array<{ name: string }>;
      system_prompt: string;
    };
    expect(withTools.tools.map((t) => t.name)).toEqual(["record_answer", "reexplain"]);
    // finish_teachback is hidden until three answers are on record.
    expect(withTools.tools.map((t) => t.name)).not.toContain("finish_teachback");
    expect(withTools.system_prompt).toContain("What happens if the market falls?");

    // The customer gets longer to think as soon as the questions start.
    const detection = updates.find((u) => "input" in u) as {
      input: { turn_detection: { min_silence: number; max_silence: number } };
    };
    expect(detection.input.turn_detection).toMatchObject({ min_silence: 2200, max_silence: 6000 });

    expect(replies[0]).toContain("I will ask you a few short questions");
    expect(replies[0]).toContain("ask question one");
  });

  it("does nothing when the phase is not NUDGE", async () => {
    const { c, state } = makeController("OBSERVE");
    await startTeachback(c);
    expect(state.phase).toBe("OBSERVE");
    expect(state.teachback).toBeUndefined();
  });

  it("goes straight to the certificate when no questions can be produced", async () => {
    stubQuestions(null, false);
    const { c, state, certified, logs } = makeController("NUDGE");
    await startTeachback(c);
    expect(logs.map((l) => l.type)).toContain("teachback.no_questions");
    expect(state.phase).toBe("CERTIFY");
    expect(certified).toEqual([null]);
  });
});

describe("recordAnswer", () => {
  it("stores the customer's own turn as the evidence, not the agent's report", () => {
    const h = asking();
    h.state.transcript.turns = [customerTurn(11, "Paanch saal lock hai, phir nikal sakti hoon")];
    const out = recordAnswer(h.c, {
      questionId: "q2",
      verdict: "understood",
      customerWords: "she said five years",
    });
    expect(out.recorded).toBe(true);
    const tb = h.state.teachback as { answers: Array<Record<string, unknown>> };
    expect(tb.answers[0]).toMatchObject({
      questionId: "q2",
      verdict: "understood",
      customerQuote: "Paanch saal lock hai, phir nikal sakti hoon",
      turnOrder: 11,
      reexplained: false,
    });
  });

  it("falls back to the agent's words when no customer turn has been finalized", () => {
    const h = asking();
    const out = recordAnswer(h.c, {
      questionId: "q1",
      verdict: "partial",
      customerWords: "value kam ho jaayega",
    });
    expect(out.recorded).toBe(true);
    const tb = h.state.teachback as { answers: Array<{ customerQuote: string }> };
    expect(tb.answers[0]?.customerQuote).toBe("value kam ho jaayega");
  });

  it("tells the agent the valid ids when it invents one", () => {
    const h = asking();
    const out = recordAnswer(h.c, { questionId: "q9", verdict: "understood", customerWords: "x" });
    expect(out.recorded).toBe(false);
    expect(out.reason).toContain("q1, q2, q3, q4");
  });

  it("refuses a second answer to the same question unless it was re-explained", () => {
    const h = asking();
    recordAnswer(h.c, { questionId: "q1", verdict: "partial", customerWords: "a" });
    const again = recordAnswer(h.c, {
      questionId: "q1",
      verdict: "understood",
      customerWords: "b",
    });
    expect(again.recorded).toBe(false);
    expect(again.reason).toContain("Ask the next one");

    markReexplained(h.c, "q1", "she missed the market link");
    const afterReexplain = recordAnswer(h.c, {
      questionId: "q1",
      verdict: "understood",
      customerWords: "market gire to kam",
    });
    expect(afterReexplain.recorded).toBe(true);
    const tb = h.state.teachback as { answers: Array<{ reexplained: boolean }> };
    expect(tb.answers).toHaveLength(1);
    expect(tb.answers[0]?.reexplained).toBe(true);
  });

  it("does not record when the teach-back is not running", () => {
    const h = makeController("OBSERVE");
    const out = recordAnswer(h.c, { questionId: "q1", verdict: "understood", customerWords: "x" });
    expect(out.recorded).toBe(false);
  });
});

describe("markReexplained", () => {
  it("allows one re-explanation per question and refuses the second", () => {
    const h = asking();
    expect(markReexplained(h.c, "q3", "charges unclear").allowed).toBe(true);
    const second = markReexplained(h.c, "q3", "still unclear");
    expect(second.allowed).toBe(false);
    expect(second.note).toContain("Move on");
  });
});

describe("progressive reveal of finish_teachback", () => {
  it("adds the tool and the matching prompt line after three answers, once", () => {
    const h = asking();
    for (const id of ["q1", "q2"]) {
      recordAnswer(h.c, { questionId: id, verdict: "understood", customerWords: "ok" });
    }
    expect(h.updates).toHaveLength(0);

    recordAnswer(h.c, { questionId: "q3", verdict: "understood", customerWords: "ok" });
    expect(h.updates).toHaveLength(1);
    const update = h.updates[0] as { tools: Array<{ name: string }>; system_prompt: string };
    expect(update.tools.map((t) => t.name)).toContain("finish_teachback");
    // The docs are explicit that tools and prompt move together.
    expect(update.system_prompt).toContain("finish_teachback");

    recordAnswer(h.c, { questionId: "q4", verdict: "partial", customerWords: "ok" });
    expect(h.updates).toHaveLength(1);
  });

  it("reveals it at exactly the documented number of answers", () => {
    expect(FINISH_AFTER_ANSWERS).toBe(3);
  });
});

describe("guardAdvisorAnswer", () => {
  it("asks the advisor once to let the customer speak, and counts it", () => {
    const h = asking();
    guardAdvisorAnswer(h.c, 0);
    expect(h.spoken).toEqual([
      `${DEFAULT_SETUP.advisorName}, please let ${DEFAULT_SETUP.customerName} answer in her own words.`,
    ]);
    const tb = h.state.teachback as { advisorInterjections: number };
    expect(tb.advisorInterjections).toBe(1);
  });

  it("stays quiet for a second interruption inside the cooldown", () => {
    const h = asking();
    guardAdvisorAnswer(h.c, 0);
    guardAdvisorAnswer(h.c, ADVISOR_GUARD_COOLDOWN_MS - 1);
    expect(h.spoken).toHaveLength(1);
    guardAdvisorAnswer(h.c, ADVISOR_GUARD_COOLDOWN_MS + 1);
    expect(h.spoken).toHaveLength(2);
    const tb = h.state.teachback as { advisorInterjections: number };
    expect(tb.advisorInterjections).toBe(2);
  });
});

describe("finishTeachback", () => {
  it("goes quiet, restores endpointing, moves to CERTIFY and passes the call id on", () => {
    const h = asking();
    finishTeachback(h.c, "She understood most of it.", "call_9");
    const tb = h.state.teachback as { status: string; summary: string };
    expect(tb.status).toBe("finishing");
    expect(tb.summary).toBe("She understood most of it.");
    expect(h.state.phase).toBe("CERTIFY");
    expect(h.certified).toEqual(["call_9"]);
    const detection = h.updates.at(-1) as {
      input: { turn_detection: { min_silence: number } };
    };
    expect(detection.input.turn_detection.min_silence).toBe(1400);
  });

  it("ignores a second call, so one certificate is written per session", () => {
    const h = asking();
    finishTeachback(h.c, "one", "call_1");
    finishTeachback(h.c, "two", "call_2");
    expect(h.certified).toEqual(["call_1"]);
  });
});
