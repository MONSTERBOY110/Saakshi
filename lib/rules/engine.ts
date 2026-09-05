import { normalise } from "./normalise";
import type { CompiledPack, Severity } from "./pack";

// Layer 1 of the analyzer (trd.md section 6.1): deterministic, synchronous, under a millisecond
// per turn. Runs in the browser on every finalized turn.

export type Role = "advisor" | "customer";

export type RuleTurn = { order: number; role?: Role; text: string };

export type RuleMatch = {
  id: string;
  kind: "checkpoint" | "prohibited";
  severity?: Severity;
  turnOrder: number;
  role: Role;
  /** Verbatim transcript of the turn that completed the match. */
  quote: string;
  pattern: string;
  /** True when the match only exists across the previous turn plus this one. */
  windowed: boolean;
};

export type Evaluation = {
  checkpoints: RuleMatch[];
  violations: RuleMatch[];
  /** Prohibited phrases spoken by the customer: recorded, never an intervention. */
  customerBeliefs: RuleMatch[];
};

const EMPTY: Evaluation = { checkpoints: [], violations: [], customerBeliefs: [] };

/**
 * Evaluate one finalized turn. `prev` is the immediately preceding finalized turn (any speaker);
 * a pattern matched only in the two-turn window counts when the match ends inside the current
 * turn, so a phrase that lives entirely in the previous turn cannot tick twice.
 */
export function evaluateTurn(pack: CompiledPack, turn: RuleTurn, prev?: RuleTurn): Evaluation {
  if (!turn.role) return EMPTY;
  const cur = normalise(turn.text);
  if (!cur) return EMPTY;
  const prevNorm = prev ? normalise(prev.text) : "";
  const quote = turn.text.trim().slice(0, 240);
  const role = turn.role;

  const find = (regexes: RegExp[], patterns: string[], allowWindow: boolean) => {
    for (let i = 0; i < regexes.length; i++) {
      if (matchesWhole(regexes[i]!, cur)) return { pattern: patterns[i]!, windowed: false };
    }
    if (!allowWindow || !prevNorm) return null;
    const window = `${prevNorm} ${cur}`;
    const curStart = prevNorm.length + 1;
    for (let i = 0; i < regexes.length; i++) {
      if (matchesEndingAfter(regexes[i]!, window, curStart)) {
        return { pattern: patterns[i]!, windowed: true };
      }
    }
    return null;
  };

  const checkpoints: RuleMatch[] = [];
  if (role === "advisor") {
    // Disclosures must come from the advisor, so the window only spans two advisor turns.
    const windowOk = prev?.role === "advisor";
    for (const c of pack.checkpoints) {
      const hit = find(c.regexes, c.patterns, windowOk);
      if (hit)
        checkpoints.push({
          id: c.id,
          kind: "checkpoint",
          turnOrder: turn.order,
          role,
          quote,
          ...hit,
        });
    }
  }

  const violations: RuleMatch[] = [];
  const customerBeliefs: RuleMatch[] = [];
  for (const p of pack.prohibited) {
    // A misleading answer often completes the customer's question, so the window spans any speaker.
    const hit = find(p.regexes, p.patterns, true);
    if (!hit) continue;
    const match: RuleMatch = {
      id: p.id,
      kind: "prohibited",
      severity: p.severity,
      turnOrder: turn.order,
      role,
      quote,
      ...hit,
    };
    (role === "advisor" ? violations : customerBeliefs).push(match);
  }

  return { checkpoints, violations, customerBeliefs };
}

function matchesWhole(re: RegExp, text: string): boolean {
  re.lastIndex = 0;
  const hit = re.test(text);
  re.lastIndex = 0;
  return hit;
}

function matchesEndingAfter(re: RegExp, text: string, boundary: number): boolean {
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    if ((m.index ?? 0) + m[0].length > boundary) return true;
  }
  return false;
}
