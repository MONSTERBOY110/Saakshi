import { evaluateTurn, type Evaluation, type Role, type RuleMatch } from "@/lib/rules/engine";
import type { Citation, CompiledPack, Severity } from "@/lib/rules/pack";
import { noteKey, type AnalyzerNote } from "./fusion";
import type { StoredTurn } from "./transcript";

// Checkpoint Board state (P0-4): required disclosures tick once with their first evidence;
// prohibited claims are recorded once per id and turn. Pure functions, serialisable state.
// Runtime facts (acknowledged, corrected, latency, nudge, analyzer notes) survive a rebuild through
// mergeSticky. Every tick and every flag comes from the deterministic rules; the analyzer's
// findings live in `notes`, which a reviewer reads and nothing else acts on.

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
  source?: "rules";
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
  source: "rules";
};

export type BeliefState = { key: string; id: string; label: string; evidence: Evidence };

/** An analyzer finding with its label resolved, for the reviewer. Not evidence. */
export type NoteState = AnalyzerNote & { key: string; label: string; evidence?: Evidence };

export type BoardState = {
  packId: string;
  definitions: Record<string, ProhibitedDefinition>;
  checkpoints: CheckpointState[];
  violations: ViolationState[];
  beliefs: BeliefState[];
  notes: NoteState[];
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
    notes: [],
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
          ? { ...c, status, evidence: ev, windowed: m.windowed, source: "rules" }
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
        { ...def, key, evidence: ev, status: "open", windowed: m.windowed, source: "rules" },
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

/**
 * Record the analyzer's findings for the reviewer. A note about a card the rules already ticked, or
 * a claim the rules already flagged, adds nothing and is dropped; everything else is kept once.
 */
export function applyNotes(
  board: BoardState,
  notes: AnalyzerNote[],
  turnFor: (order: number) => StoredTurn | undefined,
): BoardState {
  if (notes.length === 0) return board;
  const next = [...board.notes];
  for (const n of notes) {
    const key = noteKey(n);
    if (next.some((x) => x.key === key)) continue;
    if (
      n.kind === "checkpoint" &&
      board.checkpoints.some((c) => c.id === n.id && c.status !== "pending")
    ) {
      continue;
    }
    if (
      n.kind === "prohibited" &&
      board.violations.some((v) => v.key === `${n.id}@${n.turnOrder}`)
    ) {
      continue;
    }
    const label =
      n.kind === "checkpoint"
        ? board.checkpoints.find((c) => c.id === n.id)?.label
        : board.definitions[n.id]?.label;
    if (!label) continue;
    const turn = turnFor(n.turnOrder);
    const evidence = turn ? evidenceOf(turn) : undefined;
    next.push({ ...n, key, label, ...(evidence ? { evidence } : {}) });
  }
  return next.length === board.notes.length ? board : { ...board, notes: next };
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

/**
 * Copy acknowledged status and latency from the previous board, and keep the analyzer notes, which
 * are not reproducible from the rules. A note whose card the rebuild has since ticked, or whose
 * claim the rules have since flagged, is redundant and goes.
 */
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
  const notes = previous.notes.filter((n) =>
    n.kind === "checkpoint"
      ? !next.checkpoints.some((c) => c.id === n.id && c.status !== "pending")
      : !violations.some((v) => v.key === `${n.id}@${n.turnOrder}`),
  );
  return { ...next, violations, notes };
}

export function boardSummary(board: BoardState): { met: number; total: number; open: number } {
  return {
    met: board.checkpoints.filter((c) => c.status !== "pending").length,
    total: board.checkpoints.length,
    open: board.violations.filter((v) => v.status === "open").length,
  };
}

function evidenceFor(m: RuleMatch, turnFor: (order: number) => StoredTurn | undefined) {
  const turn = turnFor(m.turnOrder);
  return turn ? evidenceOf(turn) : undefined;
}
