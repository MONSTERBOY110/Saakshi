import type { Analysis } from "@/lib/analyzer/schema";
import type { Evaluation } from "@/lib/rules/engine";
import type { Severity } from "@/lib/rules/pack";

// Fusion of the deterministic layer and the LLM layer (prd.md FR-5 and principle 4: the protocol
// pack decides, the model extracts).
//
// Evidence comes from the rules alone. A critical rule match on an advisor turn intervenes at once;
// a high or medium rule match is recorded on the board and never spoken. The analyzer is advisory:
// its findings become notes for a human reviewer, shown on the board and carried in the certificate
// as notes, never as a ticked disclosure, a flagged claim or a spoken correction.
//
// Why (docs/decisions.md, 2026-09-09): on identical audio the analyzer flagged "After 5 years you
// can take the money out" as withdraw_anytime at confidence 0.8 or more, one sentence after the
// advisor had disclosed the lock-in. The rules did not. Under the previous fusion that was a spoken
// accusation against a truthful advisor and a violation in his certificate. A witness that can be
// wrong out loud is worse than one that says less.

export type RateLimitState = { lastInterventionAt: number | null };
export const INTERVENTION_COOLDOWN_MS = 60_000;
/** Analyzer findings below this confidence are not worth a reviewer's time. */
export const LLM_NOTE_CONFIDENCE = 0.6;

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
  source: "rules";
  quote: string;
};

/** What the analyzer thinks it saw. Advisory: shown to a reviewer, never evidence. */
export type AnalyzerNote = {
  kind: "checkpoint" | "prohibited";
  id: string;
  turnOrder: number;
  quote: string;
  confidence: number;
  severity?: Severity;
  rationale?: string;
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
  /** The rules' findings, unchanged: the only thing that ticks a card or flags a claim. */
  evaluation: Evaluation;
  /** The analyzer's findings, for the reviewer. */
  notes: AnalyzerNote[];
  rate: RateLimitState;
};

export const noteKey = (n: { kind: string; id: string; turnOrder: number }) =>
  `${n.kind}:${n.id}@${n.turnOrder}`;

export function notesFrom(analysis: Analysis | null | undefined): AnalyzerNote[] {
  if (!analysis) return [];
  const notes: AnalyzerNote[] = [];
  for (const c of analysis.checkpoints_satisfied) {
    if (c.confidence < LLM_NOTE_CONFIDENCE) continue;
    notes.push({
      kind: "checkpoint",
      id: c.id,
      turnOrder: c.turn_order,
      quote: c.quote,
      confidence: c.confidence,
    });
  }
  for (const v of analysis.violations) {
    if (v.confidence < LLM_NOTE_CONFIDENCE) continue;
    notes.push({
      kind: "prohibited",
      id: v.id,
      turnOrder: v.turn_order,
      quote: v.quote,
      confidence: v.confidence,
      severity: v.severity,
      ...(v.rationale ? { rationale: v.rationale } : {}),
    });
  }
  return notes;
}

export function fuse(input: FusionInput): FusionResult {
  const { rules, analysis, now, alreadyIntervened } = input;
  let rate = input.rate;
  const interventions: Intervention[] = [];
  for (const v of rules.violations) {
    if (v.severity !== "critical") continue;
    const key = `${v.id}@${v.turnOrder}`;
    if (alreadyIntervened.has(key) || interventions.some((i) => `${i.id}@${i.turnOrder}` === key)) {
      continue;
    }
    if (!interventionAllowed(rate, v.severity, now)) continue;
    interventions.push({
      id: v.id,
      severity: v.severity,
      turnOrder: v.turnOrder,
      source: "rules",
      quote: v.quote,
    });
    rate = { lastInterventionAt: now };
  }
  return { interventions, evaluation: rules, notes: notesFrom(analysis), rate };
}
