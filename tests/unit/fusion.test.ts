import { describe, expect, it } from "vitest";
import type { Analysis } from "@/lib/analyzer/schema";
import { evaluateTurn } from "@/lib/rules/engine";
import { getPack } from "@/lib/rules/load";
import {
  fuse,
  INTERVENTION_COOLDOWN_MS,
  interventionAllowed,
  LLM_NOTE_CONFIDENCE,
  notesFrom,
  type RateLimitState,
} from "@/lib/session/fusion";

// The protocol pack decides, the model extracts (prd.md principle 4). These tests pin the property
// that makes the certificate trustworthy: nothing the analyzer says can tick a card, flag a claim
// or be spoken. It can only leave a note for a reviewer.

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
    expect(r.notes).toEqual([]);
  });

  it("does not intervene on a high-severity rule match alone, but keeps it as a board violation", () => {
    const rules = evaluateTurn(pack, { order: 3, role: "advisor", text: "It is just like an FD." });
    const r = fuse({ rules, analysis: null, rate: fresh, now: 1, alreadyIntervened: new Set() });
    expect(r.interventions).toEqual([]);
    expect(r.evaluation.violations.map((v) => v.id)).toEqual(["like_fd"]);
  });

  it("turns an analyzer violation into a note, never an intervention or a board violation", () => {
    // The sentence the analyzer flagged live on 2026-09-09, one turn after the lock-in was disclosed.
    const analysis: Analysis = {
      ...emptyAnalysis,
      violations: [
        {
          id: "withdraw_anytime",
          turn_order: 9,
          quote: "After 5 years you can take the money out.",
          severity: "critical",
          confidence: 0.86,
          rationale: "implies the money can be withdrawn",
        },
      ],
    };
    const rules = evaluateTurn(pack, {
      order: 9,
      role: "advisor",
      text: "After 5 years you can take the money out.",
    });
    const r = fuse({ rules, analysis, rate: fresh, now: 10_000, alreadyIntervened: new Set() });
    expect(r.interventions).toEqual([]);
    expect(r.evaluation.violations).toEqual([]);
    expect(r.rate).toEqual(fresh);
    expect(r.notes).toEqual([
      {
        kind: "prohibited",
        id: "withdraw_anytime",
        turnOrder: 9,
        quote: "After 5 years you can take the money out.",
        confidence: 0.86,
        severity: "critical",
        rationale: "implies the money can be withdrawn",
      },
    ]);
  });

  it("turns an analyzer checkpoint into a note and never ticks the card", () => {
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
    // The rules tick charges; the analyzer's surrender_value stays a note; 0.4 is below the floor.
    expect(r.evaluation.checkpoints.map((c) => c.id)).toEqual(["charges"]);
    expect(r.notes.map((n) => `${n.kind}:${n.id}:${n.confidence}`)).toEqual([
      "checkpoint:surrender_value:0.7",
    ]);
  });

  it("drops analyzer findings below the note floor", () => {
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
          confidence: 0.5,
          rationale: "",
        },
      ],
    };
    const notes = notesFrom(analysis);
    expect(LLM_NOTE_CONFIDENCE).toBe(0.6);
    expect(notes.map((n) => n.id)).toEqual(["pressure"]);
    expect(notes[0]).not.toHaveProperty("rationale");
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
});
