import { describe, expect, it } from "vitest";
import {
  ANALYSIS_JSON_SCHEMA,
  AnalysisSchema,
  AnalyzeRequestSchema,
  sanitizeAnalysis,
  type Analysis,
} from "@/lib/analyzer/schema";
import { getPack } from "@/lib/rules/load";

const pack = getPack("insurance-ulip-in");

const good: Analysis = {
  checkpoints_satisfied: [
    { id: "lock_in_5y", turn_order: 7, quote: "There is a 5-year lock-in.", confidence: 0.95 },
  ],
  violations: [
    {
      id: "guaranteed_returns",
      turn_order: 9,
      quote: "the returns are guaranteed, 12%",
      severity: "critical",
      confidence: 0.97,
      rationale: "Advisor promised guaranteed returns on a market-linked plan.",
    },
  ],
  customer_questions_unanswered: [
    { turn_order: 8, quote: "Is my paisa cab nikal sakhti hoon?", topic: "withdrawal" },
  ],
  language_mix: "mixed",
};

describe("AnalysisSchema", () => {
  it("accepts a well-formed analysis and rejects bad severities and confidences", () => {
    expect(AnalysisSchema.safeParse(good).success).toBe(true);
    expect(
      AnalysisSchema.safeParse({
        ...good,
        violations: [{ ...good.violations[0], severity: "severe" }],
      }).success,
    ).toBe(false);
    expect(
      AnalysisSchema.safeParse({
        ...good,
        checkpoints_satisfied: [{ ...good.checkpoints_satisfied[0], confidence: 1.5 }],
      }).success,
    ).toBe(false);
  });

  it("publishes a strict JSON schema: additionalProperties false and every key required", () => {
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "object") {
        expect(n.additionalProperties, path).toBe(false);
        const props = Object.keys((n.properties ?? {}) as object);
        expect([...(n.required as string[])].sort(), path).toEqual(props.sort());
        for (const [k, v] of Object.entries(n.properties as object)) walk(v, `${path}.${k}`);
      }
      if (n.type === "array") walk(n.items, `${path}[]`);
    };
    walk(ANALYSIS_JSON_SCHEMA, "root");
    expect(Object.keys((ANALYSIS_JSON_SCHEMA as { properties: object }).properties).sort()).toEqual(
      ["checkpoints_satisfied", "customer_questions_unanswered", "language_mix", "violations"],
    );
  });

  it("sanitize drops unknown ids and turns outside the window and clamps confidence", () => {
    const messy: Analysis = {
      ...good,
      checkpoints_satisfied: [
        ...good.checkpoints_satisfied,
        { id: "made_up", turn_order: 7, quote: "x", confidence: 0.9 },
        { id: "charges", turn_order: 99, quote: "x", confidence: 0.9 },
      ],
      violations: [
        ...good.violations,
        { ...good.violations[0]!, id: "invented_rule" },
        { ...good.violations[0]!, turn_order: 3 },
      ],
    };
    const clean = sanitizeAnalysis(messy, pack, [7, 8, 9]);
    expect(clean.checkpoints_satisfied.map((c) => c.id)).toEqual(["lock_in_5y"]);
    expect(clean.violations.map((v) => `${v.id}@${v.turn_order}`)).toEqual([
      "guaranteed_returns@9",
    ]);
    expect(clean.customer_questions_unanswered).toHaveLength(1);
  });
});

describe("AnalyzeRequestSchema", () => {
  it("accepts up to eight turns with roles and context, rejects more or empty", () => {
    const turn = (order: number) => ({ order, role: "advisor" as const, text: "t", start_ms: 0 });
    const ctx = { advisor: "Rahul", customer: "Mrs. Sharma", product: "ULIP" };
    expect(
      AnalyzeRequestSchema.safeParse({
        pack_id: "insurance-ulip-in",
        turns: [turn(1)],
        context: ctx,
      }).success,
    ).toBe(true);
    expect(
      AnalyzeRequestSchema.safeParse({
        pack_id: "insurance-ulip-in",
        turns: Array.from({ length: 9 }, (_, i) => turn(i)),
        context: ctx,
      }).success,
    ).toBe(false);
    expect(
      AnalyzeRequestSchema.safeParse({ pack_id: "insurance-ulip-in", turns: [], context: ctx })
        .success,
    ).toBe(false);
  });
});
