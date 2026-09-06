import type { Analysis } from "@/lib/analyzer/schema";
import type { Evaluation, RuleMatch } from "@/lib/rules/engine";
import type { Severity } from "@/lib/rules/pack";

// Fusion of the deterministic layer and the LLM layer (prd.md FR-5, trd.md section 6.2):
// - a critical rule match on an advisor turn intervenes at once;
// - an analyzer violation with confidence 0.8 or more and severity critical or high intervenes if
//   the rate limit allows (one intervention per 60 s unless critical);
// - analyzer checkpoints with confidence 0.6 or more tick;
// - every analyzer finding still reaches the board as a violation or checkpoint.

export type RateLimitState = { lastInterventionAt: number | null };
export const INTERVENTION_COOLDOWN_MS = 60_000;
export const LLM_INTERVENE_CONFIDENCE = 0.8;
export const LLM_CHECKPOINT_CONFIDENCE = 0.6;

export function interventionAllowed(
  state: RateLimitState,
  severity: Severity,
  now: number,
): boolean {
  if (severity === "critical") return true;
  return (
    state.lastInterventionAt === null || now - state.lastInterventionAt >= INTERVENTION_COOLDOWN_MS
  );
}

export type Intervention = {
  id: string;
  severity: Severity;
  turnOrder: number;
  source: "rules" | "llm";
  quote: string;
  confidence?: number;
};

export type FusionInput = {
  rules: Evaluation;
  analysis: Analysis | null | undefined;
  rate: RateLimitState;
  now: number;
  /** Keys `${id}@${turnOrder}` already spoken about. */
  alreadyIntervened: Set<string>;
};

export type FusionResult = {
  interventions: Intervention[];
  /** Rules plus analyzer findings, ready for applyEvaluation on the board. */
  evaluation: Evaluation;
  rate: RateLimitState;
};

const keyOf = (m: { id: string; turnOrder: number }) => `${m.id}@${m.turnOrder}`;

export function fuse(input: FusionInput): FusionResult {
  const { rules, analysis, now, alreadyIntervened } = input;
  const checkpoints: RuleMatch[] = [...rules.checkpoints];
  const violations: RuleMatch[] = [...rules.violations];

  if (analysis) {
    for (const c of analysis.checkpoints_satisfied) {
      if (c.confidence < LLM_CHECKPOINT_CONFIDENCE) continue;
      if (checkpoints.some((x) => x.id === c.id)) continue;
      checkpoints.push({
        id: c.id,
        kind: "checkpoint",
        turnOrder: c.turn_order,
        role: "advisor",
        quote: c.quote,
        pattern: `llm:${c.confidence.toFixed(2)}`,
        windowed: false,
      });
    }
    for (const v of analysis.violations) {
      if (violations.some((x) => keyOf(x) === `${v.id}@${v.turn_order}`)) continue;
      violations.push({
        id: v.id,
        kind: "prohibited",
        severity: v.severity,
        turnOrder: v.turn_order,
        role: "advisor",
        quote: v.quote,
        pattern: `llm:${v.confidence.toFixed(2)}:${v.rationale}`,
        windowed: false,
      });
    }
  }

  let rate = input.rate;
  const interventions: Intervention[] = [];
  const consider = (m: RuleMatch, source: Intervention["source"], confidence?: number) => {
    const key = keyOf(m);
    if (!m.severity) return;
    if (alreadyIntervened.has(key) || interventions.some((i) => keyOf(i) === key)) return;
    if (!interventionAllowed(rate, m.severity, now)) return;
    interventions.push({
      id: m.id,
      severity: m.severity,
      turnOrder: m.turnOrder,
      source,
      quote: m.quote,
      confidence,
    });
    rate = { lastInterventionAt: now };
  };

  for (const v of rules.violations) if (v.severity === "critical") consider(v, "rules");
  if (analysis) {
    for (const v of analysis.violations) {
      if (v.confidence < LLM_INTERVENE_CONFIDENCE) continue;
      if (v.severity !== "critical" && v.severity !== "high") continue;
      const match = violations.find((x) => keyOf(x) === `${v.id}@${v.turn_order}`);
      if (match) consider(match, "llm", v.confidence);
    }
  }

  return {
    interventions,
    evaluation: {
      checkpoints,
      violations,
      customerBeliefs: rules.customerBeliefs,
      corrections: rules.corrections,
    },
    rate,
  };
}
