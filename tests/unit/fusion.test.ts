import { describe, expect, it } from "vitest";
import type { Analysis } from "@/lib/analyzer/schema";
import { evaluateTurn } from "@/lib/rules/engine";
import { getPack } from "@/lib/rules/load";
import {
  fuse,
  INTERVENTION_COOLDOWN_MS,
  interventionAllowed,
  type RateLimitState,
} from "@/lib/session/fusion";

const pack = getPack("insurance-ulip-in");
const fresh: RateLimitState = { lastInterventionAt: null };
const emptyAnalysis: Analysis = {
  checkpoints_satisfied: [],
  violations: [],
  customer_questions_unanswered: [],
  language_mix: "en",
};

describe("interventionAllowed", () => {
  it("always allows critical, and non-critical once per 60 s", () => {
    expect(interventionAllowed(fresh, "critical", 1000)).toBe(true);
    expect(interventionAllowed(fresh, "high", 1000)).toBe(true);
    const recent: RateLimitState = { lastInterventionAt: 1000 };
    expect(interventionAllowed(recent, "high", 1000 + 30_000)).toBe(false);
    expect(interventionAllowed(recent, "medium", 1000 + 30_000)).toBe(false);
    expect(interventionAllowed(recent, "critical", 1000 + 30_000)).toBe(true);
    expect(interventionAllowed(recent, "high", 1000 + INTERVENTION_COOLDOWN_MS)).toBe(true);
  });
});

describe("fuse", () => {
  it("intervenes at once on a critical rule match, without the analyzer", () => {
    const rules = evaluateTurn(pack, {
      order: 9,
      role: "advisor",
      text: "Anytime, madam, and the returns are guaranteed, 12%.",
    });
    const r = fuse({ rules, analysis: null, rate: fresh, now: 5000, alreadyIntervened: new Set() });
    expect(r.interventions.map((i) => `${i.id}@${i.turnOrder}:${i.source}`)).toEqual([
      "guaranteed_returns@9:rules",
    ]);
    expect(r.rate.lastInterventionAt).toBe(5000);
  });

  it("does not intervene on a high-severity rule match alone, but keeps it as a board violation", () => {
    const rules = evaluateTurn(pack, { order: 3, role: "advisor", text: "It is just like an FD." });
    const r = fuse({ rules, analysis: null, rate: fresh, now: 1, alreadyIntervened: new Set() });
    expect(r.interventions).toEqual([]);
    expect(r.evaluation.violations.map((v) => v.id)).toEqual(["like_fd"]);
  });

  it("intervenes on an analyzer violation with confidence 0.8+ and severity high, once per cooldown", () => {
    const analysis: Analysis = {
      ...emptyAnalysis,
      violations: [
        {
          id: "like_fd",
          turn_order: 3,
          quote: "same as your bank deposit",
          severity: "high",
          confidence: 0.86,
          rationale: "compared to a deposit",
        },
      ],
    };
    const rules = evaluateTurn(pack, {
      order: 3,
      role: "advisor",
      text: "It is the same as your bank deposit, really.",
    });
    const first = fuse({ rules, analysis, rate: fresh, now: 10_000, alreadyIntervened: new Set() });
    expect(first.interventions.map((i) => `${i.id}:${i.source}`)).toEqual(["like_fd:llm"]);
    const second = fuse({
      rules: evaluateTurn(pack, { order: 5, role: "advisor", text: "Fully tax free, always." }),
      analysis: {
        ...emptyAnalysis,
        violations: [
          {
            id: "tax_free_forever",
            turn_order: 5,
            quote: "Fully tax free, always.",
            severity: "high",
            confidence: 0.9,
            rationale: "unconditional tax claim",
          },
        ],
      },
      rate: first.rate,
      now: 10_000 + 20_000,
      alreadyIntervened: new Set(["like_fd@3"]),
    });
    expect(second.interventions).toEqual([]);
    expect(second.evaluation.violations.map((v) => v.id)).toContain("tax_free_forever");
  });

  it("ignores analyzer violations below 0.8 and medium severity for interventions", () => {
    const analysis: Analysis = {
      ...emptyAnalysis,
      violations: [
        {
          id: "pressure",
          turn_order: 4,
          quote: "sign today",
          severity: "medium",
          confidence: 0.95,
          rationale: "",
        },
        {
          id: "no_charges",
          turn_order: 4,
          quote: "no charges",
          severity: "high",
          confidence: 0.7,
          rationale: "",
        },
      ],
    };
    const rules = evaluateTurn(pack, { order: 4, role: "advisor", text: "Please decide soon." });
    const r = fuse({ rules, analysis, rate: fresh, now: 1, alreadyIntervened: new Set() });
    expect(r.interventions).toEqual([]);
    // Both still reach the board as violations from the analyzer.
    expect(r.evaluation.violations.map((v) => v.id).sort()).toEqual(["no_charges", "pressure"]);
  });

  it("never intervenes twice for the same id and turn", () => {
    const rules = evaluateTurn(pack, {
      order: 9,
      role: "advisor",
      text: "Anytime, madam, and the returns are guaranteed, 12%.",
    });
    const r = fuse({
      rules,
      analysis: null,
      rate: fresh,
      now: 1,
      alreadyIntervened: new Set(["guaranteed_returns@9"]),
    });
    expect(r.interventions).toEqual([]);
  });

  it("ticks analyzer checkpoints at confidence 0.6 or more and carries rule checkpoints through", () => {
    const rules = evaluateTurn(pack, {
      order: 12,
      role: "advisor",
      text: "There are charges, including premium allocation.",
    });
    const analysis: Analysis = {
      ...emptyAnalysis,
      checkpoints_satisfied: [
        {
          id: "surrender_value",
          turn_order: 12,
          quote: "if you stop early you get less back",
          confidence: 0.7,
        },
        { id: "free_look_30", turn_order: 12, quote: "you can return it", confidence: 0.4 },
      ],
    };
    const r = fuse({ rules, analysis, rate: fresh, now: 1, alreadyIntervened: new Set() });
    // "premium allocation" is the name of a charge, so this turn discloses charges and nothing
    // about the premium the customer pays. The eval corpus caught the pattern that used to tick
    // premium_and_term here.
    expect(r.evaluation.checkpoints.map((c) => c.id).sort()).toEqual(
      ["charges", "surrender_value"].sort(),
    );
    const llm = r.evaluation.checkpoints.find((c) => c.id === "surrender_value");
    expect(llm?.pattern.startsWith("llm:")).toBe(true);
  });
});
