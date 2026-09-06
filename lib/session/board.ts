import { evaluateTurn, type Evaluation, type Role, type RuleMatch } from "@/lib/rules/engine";
import type { Citation, CompiledPack, Severity } from "@/lib/rules/pack";
import type { StoredTurn } from "./transcript";

// Checkpoint Board state (P0-4): required disclosures tick once with their first evidence;
// prohibited claims are recorded once per id and turn. Pure functions, serialisable state.
// Runtime facts (acknowledged, corrected, latency, nudge) survive a rebuild through mergeSticky.

export type Evidence = {
  turnOrder: number;
  role: Role;
  startMs: number;
  endMs: number;
  quote: string;
  language: string;
};

export type CheckpointStatus = "pending" | "met" | "met_after_nudge";

export type CheckpointState = {
  id: string;
  label: string;
  /** The name the tabla card carries; the full label when the pack gives no short form. */
  shortLabel: string;
  hint: string;
  citation: Citation;
  status: CheckpointStatus;
  evidence?: Evidence;
  windowed?: boolean;
  source?: "rules" | "llm";
};

export type ProhibitedDefinition = {
  id: string;
  label: string;
  severity: Severity;
  citation: Citation;
  correction: string;
};

export type ViolationStatus = "open" | "corrected" | "acknowledged";

export type ViolationState = ProhibitedDefinition & {
  key: string;
  evidence: Evidence;
  status: ViolationStatus;
  latencyMs?: number;
  windowed: boolean;
  source: "rules" | "llm";
};

export type BeliefState = { key: string; id: string; label: string; evidence: Evidence };

export type BoardState = {
  packId: string;
  definitions: Record<string, ProhibitedDefinition>;
  checkpoints: CheckpointState[];
  violations: ViolationState[];
  beliefs: BeliefState[];
  /** Turn order at which the nudge was spoken; disclosures after it are met_after_nudge. */
  nudgedAtOrder?: number;
};

export function emptyBoard(pack: CompiledPack): BoardState {
  const definitions: Record<string, ProhibitedDefinition> = {};
  for (const p of pack.prohibited) {
    definitions[p.id] = {
      id: p.id,
      label: p.label,
      severity: p.severity,
      citation: p.citation,
      correction: p.correction,
    };
  }
  return {
    packId: pack.id,
    definitions,
    checkpoints: pack.checkpoints.map((c) => ({
      id: c.id,
      label: c.label,
      shortLabel: c.short_label ?? c.label,
      hint: c.hint,
      citation: c.citation,
      status: "pending",
    })),
    violations: [],
    beliefs: [],
  };
}

export function evidenceOf(turn: StoredTurn): Evidence | undefined {
  if (!turn.role) return undefined;
  return {
    turnOrder: turn.order,
    role: turn.role,
    startMs: turn.startMs,
    endMs: turn.endMs,
    quote: turn.text,
    language: turn.language,
  };
}

export function applyEvaluation(
  board: BoardState,
  evaluation: Evaluation,
  turnFor: (order: number) => StoredTurn | undefined,
): BoardState {
  let next = board;
  for (const m of evaluation.checkpoints) {
    const ev = evidenceFor(m, turnFor);
    if (!ev) continue;
    const status: CheckpointStatus =
      next.nudgedAtOrder !== undefined && m.turnOrder > next.nudgedAtOrder
        ? "met_after_nudge"
        : "met";
    next = {
      ...next,
      checkpoints: next.checkpoints.map((c) =>
        c.id === m.id && c.status === "pending"
          ? { ...c, status, evidence: ev, windowed: m.windowed, source: sourceOf(m) }
          : c,
      ),
    };
  }
  for (const m of evaluation.violations) {
    const key = `${m.id}@${m.turnOrder}`;
    if (next.violations.some((v) => v.key === key)) continue;
    const ev = evidenceFor(m, turnFor);
    const def = next.definitions[m.id];
    if (!ev || !def) continue;
    next = {
      ...next,
      violations: [
        ...next.violations,
        { ...def, key, evidence: ev, status: "open", windowed: m.windowed, source: sourceOf(m) },
      ],
    };
  }
  for (const m of evaluation.customerBeliefs) {
    const key = `${m.id}@${m.turnOrder}`;
    if (next.beliefs.some((b) => b.key === key)) continue;
    const ev = evidenceFor(m, turnFor);
    const def = next.definitions[m.id];
    if (!ev || !def) continue;
    next = {
      ...next,
      beliefs: [...next.beliefs, { key, id: m.id, label: def.label, evidence: ev }],
    };
  }
  return next;
}

/** An advisor turn at `turnOrder` corrected these claims: earlier open violations become corrected. */
export function applyCorrections(board: BoardState, ids: string[], turnOrder: number): BoardState {
  if (ids.length === 0) return board;
  const set = new Set(ids);
  return {
    ...board,
    violations: board.violations.map((v) =>
      v.status === "open" && set.has(v.id) && v.evidence.turnOrder < turnOrder
        ? { ...v, status: "corrected" }
        : v,
    ),
  };
}

export function acknowledgeViolation(board: BoardState, key: string): BoardState {
  return {
    ...board,
    violations: board.violations.map((v) =>
      v.key === key && v.status === "open" ? { ...v, status: "acknowledged" } : v,
    ),
  };
}

export function setViolationLatency(board: BoardState, key: string, latencyMs: number): BoardState {
  return {
    ...board,
    violations: board.violations.map((v) => (v.key === key ? { ...v, latencyMs } : v)),
  };
}

export function markNudged(board: BoardState, turnOrder: number): BoardState {
  return { ...board, nudgedAtOrder: turnOrder };
}

/** Deterministic rebuild from every finalized turn; runtime facts are carried over from `previous`. */
export function rebuildBoard(
  pack: CompiledPack,
  turns: StoredTurn[],
  previous?: BoardState,
): BoardState {
  const finals = turns.filter((t) => t.final && !t.echo).sort((a, b) => a.order - b.order);
  const byOrder = new Map(finals.map((t) => [t.order, t]));
  let board: BoardState = { ...emptyBoard(pack), nudgedAtOrder: previous?.nudgedAtOrder };
  let prev: StoredTurn | undefined;
  for (const t of finals) {
    const evaluation = evaluateTurn(
      pack,
      { order: t.order, role: t.role, text: t.text },
      prev ? { order: prev.order, role: prev.role, text: prev.text } : undefined,
    );
    board = applyEvaluation(board, evaluation, (o) => byOrder.get(o));
    board = applyCorrections(board, evaluation.corrections, t.order);
    prev = t;
  }
  return previous ? mergeSticky(previous, board) : board;
}

/** Copy acknowledged status, latency and LLM-sourced findings from the previous board. */
export function mergeSticky(previous: BoardState, next: BoardState): BoardState {
  const prevViolations = new Map(previous.violations.map((v) => [v.key, v]));
  const violations = next.violations.map((v) => {
    const p = prevViolations.get(v.key);
    if (!p) return v;
    return {
      ...v,
      latencyMs: p.latencyMs ?? v.latencyMs,
      status: p.status === "acknowledged" ? "acknowledged" : v.status,
    };
  });
  // Analyzer findings are not reproducible from the rules; keep the ones the rebuild did not find.
  for (const p of previous.violations) {
    if (p.source === "llm" && !violations.some((v) => v.key === p.key)) violations.push(p);
  }
  const checkpoints = next.checkpoints.map((c) => {
    if (c.status !== "pending") return c;
    const p = previous.checkpoints.find((x) => x.id === c.id);
    return p && p.source === "llm" && p.status !== "pending" ? p : c;
  });
  return { ...next, violations, checkpoints };
}

export function boardSummary(board: BoardState): { met: number; total: number; open: number } {
  return {
    met: board.checkpoints.filter((c) => c.status !== "pending").length,
    total: board.checkpoints.length,
    open: board.violations.filter((v) => v.status === "open").length,
  };
}

function sourceOf(m: RuleMatch): "rules" | "llm" {
  return m.pattern.startsWith("llm:") ? "llm" : "rules";
}

function evidenceFor(m: RuleMatch, turnFor: (order: number) => StoredTurn | undefined) {
  const turn = turnFor(m.turnOrder);
  return turn ? evidenceOf(turn) : undefined;
}
