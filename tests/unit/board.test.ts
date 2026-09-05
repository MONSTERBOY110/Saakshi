import { describe, expect, it } from "vitest";
import { getPack } from "@/lib/rules/load";
import { applyEvaluation, boardSummary, emptyBoard, rebuildBoard } from "@/lib/session/board";
import type { StoredTurn } from "@/lib/session/transcript";
import { evaluateTurn } from "@/lib/rules/engine";

const pack = getPack("insurance-ulip-in");

const turn = (
  order: number,
  role: "advisor" | "customer" | undefined,
  text: string,
): StoredTurn => ({
  order,
  text,
  final: true,
  formatted: true,
  speakerLabel: role === "advisor" ? "A" : role === "customer" ? "B" : "PENDING",
  role,
  language: "en",
  startMs: order * 5000,
  endMs: order * 5000 + 3000,
  words: [],
  revised: false,
  pending: role === undefined,
});

const script: StoredTurn[] = [
  turn(0, "advisor", "Good morning, Mrs. Sharma."),
  turn(1, "advisor", "My name is Rahul."),
  turn(2, undefined, "Namaste."),
  turn(3, "customer", "My name is Mrs. Sharma."),
  turn(4, "advisor", "This is a unit-linked insurance plan."),
  turn(
    5,
    "advisor",
    "You pay a premium of ₹50,000 every year for 10 years, and the policy term is 15 years.",
  ),
  turn(
    6,
    "advisor",
    "The money goes into market-linked funds, so the fund value depends on the market.",
  ),
  turn(7, "advisor", "There is a 5-year lock-in."),
  turn(8, "customer", "Is my paisa cab nikal sakhti hoon?"),
  turn(9, "advisor", "Anytime, madam, and the returns are guaranteed, 12%."),
  turn(10, "advisor", "Sorry, let me correct that."),
  turn(11, "advisor", "Returns are not guaranteed."),
  turn(
    12,
    "advisor",
    "There are charges, including premium allocation and fund management charges.",
  ),
  turn(13, "advisor", "The benefit illustration shows values at 4% and 8%."),
  turn(14, "advisor", "The surrender value applies after the lock-in."),
  turn(15, "advisor", "Saakshi, verify."),
  turn(16, "advisor", "You also have a 30-day free look period to return the policy."),
  turn(17, "customer", "पांच साल, five years, उसके बाद निकल सकती हूँ।"),
];

describe("checkpoint board", () => {
  it("starts with every checkpoint pending and nothing flagged", () => {
    const b = emptyBoard(pack);
    expect(b.checkpoints).toHaveLength(8);
    expect(b.checkpoints.every((c) => c.status === "pending")).toBe(true);
    expect(boardSummary(b)).toEqual({ met: 0, total: 8, open: 0 });
  });

  it("ticks a checkpoint once with the first evidence and keeps it", () => {
    let b = emptyBoard(pack);
    const t5 = script[5]!;
    const t12 = script[12]!;
    b = applyEvaluation(b, evaluateTurn(pack, t5), () => t5);
    const first = b.checkpoints.find((c) => c.id === "premium_and_term");
    expect(first?.status).toBe("met");
    expect(first?.evidence).toMatchObject({
      turnOrder: 5,
      role: "advisor",
      startMs: 25000,
      quote: t5.text,
    });
    b = applyEvaluation(b, evaluateTurn(pack, t12), () => t12);
    expect(b.checkpoints.find((c) => c.id === "premium_and_term")?.evidence?.turnOrder).toBe(5);
    expect(b.checkpoints.find((c) => c.id === "charges")?.status).toBe("met");
  });

  it("records violations once per id and turn with severity, citation and correction", () => {
    let b = emptyBoard(pack);
    const t9 = script[9]!;
    const ev = evaluateTurn(pack, t9, script[8]);
    b = applyEvaluation(b, ev, () => t9);
    b = applyEvaluation(b, ev, () => t9);
    expect(b.violations.map((v) => v.key).sort()).toEqual([
      "guaranteed_returns@9",
      "withdraw_anytime@9",
    ]);
    const g = b.violations.find((v) => v.id === "guaranteed_returns");
    expect(g).toMatchObject({
      severity: "critical",
      status: "open",
      correction: expect.stringContaining("guaranteed"),
    });
    expect(g?.citation.authority).toBe("IRDAI");
    expect(boardSummary(b).open).toBe(2);
  });

  it("stores customer beliefs separately", () => {
    let b = emptyBoard(pack);
    const t = turn(3, "customer", "Matlab returns guaranteed hai na?");
    b = applyEvaluation(b, evaluateTurn(pack, t), () => t);
    expect(b.violations).toEqual([]);
    expect(b.beliefs.map((x) => x.id)).toEqual(["guaranteed_returns"]);
  });

  it("rebuilds the whole board from the golden script", () => {
    const b = rebuildBoard(pack, script);
    expect(boardSummary(b)).toEqual({ met: 8, total: 8, open: 2 });
    expect(b.checkpoints.find((c) => c.id === "free_look_30")?.evidence?.turnOrder).toBe(16);
    expect(b.checkpoints.find((c) => c.id === "lock_in_5y")?.evidence?.turnOrder).toBe(7);
  });

  it("rebuild drops evidence from a turn that a revision moved to the customer", () => {
    const revised = script.map((t) =>
      t.order === 7 ? { ...t, role: "customer" as const, speakerLabel: "B" } : t,
    );
    const b = rebuildBoard(pack, revised);
    // lock-in is still met later by turn 14 ("after the lock-in"), from a different turn.
    expect(b.checkpoints.find((c) => c.id === "lock_in_5y")?.evidence?.turnOrder).toBe(14);
  });
});
