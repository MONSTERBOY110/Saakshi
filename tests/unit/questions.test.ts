import { describe, expect, it } from "vitest";
import { getPack } from "@/lib/rules/load";
import { rebuildBoard } from "@/lib/session/board";
import type { StoredTurn } from "@/lib/session/transcript";
import {
  fallbackQuestions,
  isLeadingQuestion,
  mergeQuestions,
  MAX_QUESTION_WORDS,
  prioritiseTopics,
  validateQuestion,
  type GeneratedQuestion,
} from "@/lib/teachback/questions";

const pack = getPack("insurance-ulip-in");

const turn = (
  order: number,
  text: string,
  role: "advisor" | "customer" = "advisor",
): StoredTurn => ({
  order,
  text,
  final: true,
  formatted: true,
  speakerLabel: role === "advisor" ? "A" : "B",
  role,
  language: "en",
  startMs: order * 3000,
  endMs: order * 3000 + 2000,
  words: [],
  revised: false,
  pending: false,
});

// A pitch that flags guaranteed returns and never mentions the free look.
const turns = [
  turn(0, "You pay fifty thousand every year for ten years, policy term fifteen years."),
  turn(1, "The money is market-linked and there is a five year lock-in."),
  turn(2, "Anytime, madam, and the returns are guaranteed, 12%."),
  turn(3, "There are charges, including premium allocation."),
];
const board = rebuildBoard(pack, turns);
const ctx = { pack, board, spokenText: turns.map((t) => t.text).join(" ") };

describe("prioritiseTopics", () => {
  it("puts the topics behind flagged claims ahead of the rest", () => {
    const order = prioritiseTopics(pack, board).map((t) => t.id);
    // The pitch flags guaranteed returns (market risk) and withdraw anytime (lock-in).
    expect(order.slice(0, 2).sort()).toEqual(["lock_in", "market_risk"]);
    // A disclosure that was never made outranks one that was.
    expect(order.indexOf("free_look")).toBeLessThan(order.indexOf("premium_term"));
  });

  it("returns every pack topic exactly once", () => {
    const ids = prioritiseTopics(pack, board).map((t) => t.id);
    expect(new Set(ids).size).toBe(pack.teachback_topics.length);
  });
});

describe("fallbackQuestions", () => {
  it("offers four speakable questions with expected points", () => {
    const qs = fallbackQuestions(pack, board);
    expect(qs).toHaveLength(4);
    expect(qs.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4"]);
    for (const q of qs) {
      expect(q.question.split(/\s+/).length).toBeLessThanOrEqual(MAX_QUESTION_WORDS);
      expect(q.question).not.toMatch(/[!*_#`]/);
      expect(q.expectedPoints.length).toBeGreaterThan(0);
      expect(q.source).toBe("pack");
    }
  });

  it("asks about a flagged topic first", () => {
    expect(["market_risk", "lock_in"]).toContain(fallbackQuestions(pack, board)[0]?.topic);
  });
});

describe("validateQuestion", () => {
  const good: GeneratedQuestion = {
    id: "q1",
    topic: "lock_in",
    question_en: "For how long is your money locked in?",
    expected_points: ["five years"],
    hint_hi: "Paisa kitne saal lock rahega?",
  };

  it("accepts a short, plain question on a known topic", () => {
    expect(validateQuestion(good, ctx)).toBe(true);
  });

  it("rejects questions longer than eighteen words", () => {
    const long = Array.from({ length: 19 }, (_, i) => `word${i}`).join(" ");
    expect(validateQuestion({ ...good, question_en: `${long}?` }, ctx)).toBe(false);
  });

  it("rejects markdown and exclamation marks, which the voice would read aloud", () => {
    expect(validateQuestion({ ...good, question_en: "**How long** is the lock-in?" }, ctx)).toBe(
      false,
    );
    expect(validateQuestion({ ...good, question_en: "How long is the lock-in!" }, ctx)).toBe(false);
  });

  it("rejects an unknown topic", () => {
    expect(validateQuestion({ ...good, topic: "invented" }, ctx)).toBe(false);
  });

  it("rejects a number nobody said", () => {
    expect(validateQuestion({ ...good, question_en: "Is the lock-in 7 years?" }, ctx)).toBe(false);
  });

  it("accepts a digit for a number that was spoken as a word", () => {
    // The advisor said "a five year lock-in" and "12%".
    expect(validateQuestion({ ...good, question_en: "Is the lock-in 5 years?" }, ctx)).toBe(true);
    expect(
      validateQuestion(
        { ...good, topic: "market_risk", question_en: "Were 12 percent returns promised?" },
        ctx,
      ),
    ).toBe(true);
  });

  it("rejects an empty question", () => {
    expect(validateQuestion({ ...good, question_en: "   " }, ctx)).toBe(false);
  });
});

describe("mergeQuestions", () => {
  const generated: GeneratedQuestion[] = [
    {
      id: "x",
      topic: "market_risk",
      question_en: "What happens to your money if the market falls?",
      expected_points: ["value can fall"],
      hint_hi: "Market gire to paise ka kya hoga?",
    },
    {
      id: "y",
      topic: "lock_in",
      question_en: "For how long is your money locked in?",
      expected_points: ["five years"],
      hint_hi: "Kitne saal lock?",
    },
  ];

  it("keeps valid generated questions and renumbers them", () => {
    const merged = mergeQuestions(generated, ctx);
    expect(merged.slice(0, 2).map((q) => `${q.id}:${q.topic}:${q.source}`)).toEqual([
      "q1:market_risk:llm",
      "q2:lock_in:llm",
    ]);
  });

  it("tops up from the pack to at least three questions", () => {
    const merged = mergeQuestions([generated[0]!], ctx);
    expect(merged.length).toBeGreaterThanOrEqual(3);
    expect(merged[0]?.source).toBe("llm");
    expect(merged.slice(1).every((q) => q.source === "pack")).toBe(true);
  });

  it("falls back entirely when the model returns nothing usable", () => {
    const rubbish: GeneratedQuestion[] = [
      { id: "a", topic: "nope", question_en: "x", expected_points: [], hint_hi: "" },
      { ...generated[0]!, question_en: "Will you get 99 percent returns?" },
    ];
    const merged = mergeQuestions(rubbish, ctx);
    expect(merged.length).toBeGreaterThanOrEqual(3);
    expect(merged.every((q) => q.source === "pack")).toBe(true);
  });

  it("never asks two questions on the same topic and never exceeds five", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...generated[0]!,
      id: `g${i}`,
      topic: i % 2 === 0 ? "market_risk" : "charges",
      question_en: "What charges will be taken from your premium?",
    }));
    const merged = mergeQuestions(many, ctx);
    expect(merged.length).toBeLessThanOrEqual(5);
    expect(new Set(merged.map((q) => q.topic)).size).toBe(merged.length);
  });
});

describe("leading questions", () => {
  // From the live run on 2026-09-06: four of five generated questions stated the answer.
  const seenLive = [
    "Please explain in your own words that the value depends on the market.",
    "Can you explain in your own words that surrendering early gives less than the fund value?",
    "Please explain in your own words that the plan has charges that reduce the amount invested.",
    "Can you explain in your own words that you can return the policy within thirty days?",
  ];

  it("rejects a question that hands the customer the answer", () => {
    for (const text of seenLive) expect(isLeadingQuestion(text)).toBe(true);
  });

  it("accepts an open question on the same topic", () => {
    for (const text of [
      "What happens to your money if the market falls?",
      "What charges will be taken from your premium?",
      "Can you tell me in your own words about the five year lock in period?",
      "How long do you have to return the policy if you change your mind?",
    ]) {
      expect(isLeadingQuestion(text)).toBe(false);
    }
  });

  it("drops a leading question and one that is not a question at all", () => {
    const base = { id: "q1", topic: "market_risk", expected_points: [], hint_hi: "" };
    expect(validateQuestion({ ...base, question_en: seenLive[0]! }, ctx)).toBe(false);
    expect(
      validateQuestion({ ...base, question_en: "Tell me what happens if the market falls." }, ctx),
    ).toBe(false);
  });

  it("keeps every pack fallback valid under the stricter rules", () => {
    for (const q of fallbackQuestions(pack, board)) {
      expect(
        validateQuestion(
          {
            id: q.id,
            topic: q.topic,
            question_en: q.question,
            expected_points: q.expectedPoints,
            hint_hi: q.hintHi ?? "",
          },
          ctx,
        ),
        q.question,
      ).toBe(true);
    }
  });
});
