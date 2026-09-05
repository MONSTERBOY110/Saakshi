import { evaluateTurn, type Evaluation, type Role, type RuleMatch } from "@/lib/rules/engine";
import type { Citation, CompiledPack, Severity } from "@/lib/rules/pack";
import type { StoredTurn } from "./transcript";

// Checkpoint Board state (P0-4): required disclosures tick once with their first evidence;
// prohibited claims are recorded once per id and turn. Pure functions, serialisable state.

export type Evidence = {
  turnOrder: number;
  role: Role;
  startMs: number;
  endMs: number;
  quote: string;
  language: string;
};

export type CheckpointState = {
  id: string;
  label: string;
  hint: string;
  citation: Citation;
  status: "pending" | "met";
  evidence?: Evidence;
  windowed?: boolean;
};

export type ProhibitedDefinition = {
  id: string;
  label: string;
  severity: Severity;
  citation: Citation;
  correction: string;
};

export type ViolationState = ProhibitedDefinition & {
  key: string;
  evidence: Evidence;
  status: "open" | "corrected" | "acknowledged";
  latencyMs?: number;
  windowed: boolean;
};

export type BeliefState = { key: string; id: string; label: string; evidence: Evidence };

export type BoardState = {
  packId: string;
  definitions: Record<string, ProhibitedDefinition>;
  checkpoints: CheckpointState[];
  violations: ViolationState[];
  beliefs: BeliefState[];
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
    next = {
      ...next,
      checkpoints: next.checkpoints.map((c) =>
        c.id === m.id && c.status === "pending"
          ? { ...c, status: "met", evidence: ev, windowed: m.windowed }
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
        { ...def, key, evidence: ev, status: "open", windowed: m.windowed },
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

/** Deterministic rebuild from every finalized turn, used after revisions and role swaps. */
export function rebuildBoard(pack: CompiledPack, turns: StoredTurn[]): BoardState {
  const finals = turns.filter((t) => t.final).sort((a, b) => a.order - b.order);
  const byOrder = new Map(finals.map((t) => [t.order, t]));
  let board = emptyBoard(pack);
  let prev: StoredTurn | undefined;
  for (const t of finals) {
    const evaluation = evaluateTurn(
      pack,
      { order: t.order, role: t.role, text: t.text },
      prev ? { order: prev.order, role: prev.role, text: prev.text } : undefined,
    );
    board = applyEvaluation(board, evaluation, (o) => byOrder.get(o));
    prev = t;
  }
  return board;
}

export function boardSummary(board: BoardState): { met: number; total: number; open: number } {
  return {
    met: board.checkpoints.filter((c) => c.status === "met").length,
    total: board.checkpoints.length,
    open: board.violations.filter((v) => v.status === "open").length,
  };
}

function evidenceFor(m: RuleMatch, turnFor: (order: number) => StoredTurn | undefined) {
  const turn = turnFor(m.turnOrder);
  return turn ? evidenceOf(turn) : undefined;
}
