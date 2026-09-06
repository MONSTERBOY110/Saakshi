import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPack, PACK_IDS } from "@/lib/rules/load";
import { summarise, type Scored, type Summary } from "./score";
import { rebuildBoard } from "@/lib/session/board";
import type { StoredTurn } from "@/lib/session/transcript";

// The eval harness (prd.md P1-2). It scores the deterministic rule engine against a hand-labelled
// corpus in eval/corpus, one turn at a time. tests/unit/eval-run.test.ts drives it, writes
// eval/report.json for the /metrics page, and holds the thresholds.
//
// The labels are what a compliance reviewer would mark from the sentence alone. Where the engine
// disagrees, the disagreement goes into the report rather than being smoothed away.

export type CorpusTurn = {
  id: string;
  pack: string;
  text: string;
  violations: string[];
  checkpoints: string[];
};

export type LayerReport = Summary & { layer: string };

export type EvalReport = {
  ran_at: string;
  corpus: { turns: number; packs: Record<string, number> };
  layers: LayerReport[];
  /** Set when the live layers were not run, so a reader knows why they are absent. */
  note?: string;
};

export function loadCorpus(dir = join(process.cwd(), "eval", "corpus")): CorpusTurn[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  const turns: CorpusTurn[] = [];
  for (const file of files) {
    const lines = readFileSync(join(dir, file), "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) turns.push(JSON.parse(line) as CorpusTurn);
  }
  return turns;
}

/** One corpus line as the room would have stored it: an advisor turn, finalized. */
function asTurn(t: CorpusTurn): StoredTurn {
  return {
    order: 0,
    text: t.text,
    final: true,
    formatted: true,
    speakerLabel: "A",
    role: "advisor",
    language: "en",
    startMs: 0,
    endMs: 3000,
    words: [],
    revised: false,
    pending: false,
  };
}

/**
 * Each turn is scored on its own board, so a turn is judged by what it says rather than by what
 * some earlier turn happened to establish. The two-turn window the live engine uses is deliberately
 * not given here: this measures the patterns, not the conversation.
 */
export function scoreRules(corpus: CorpusTurn[]): Summary {
  const rows: Scored[] = [];
  for (const t of corpus) {
    const pack = getPack(t.pack);
    const board = rebuildBoard(pack, [asTurn(t)]);
    rows.push({
      id: t.id,
      pack: t.pack,
      text: t.text,
      kind: "violation",
      expected: t.violations,
      predicted: board.violations.map((v) => v.id),
    });
    rows.push({
      id: t.id,
      pack: t.pack,
      text: t.text,
      kind: "checkpoint",
      expected: t.checkpoints,
      predicted: board.checkpoints.filter((c) => c.status !== "pending").map((c) => c.id),
    });
  }
  return summarise(rows);
}

function packCounts(corpus: CorpusTurn[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of PACK_IDS) counts[id] = 0;
  for (const t of corpus) counts[t.pack] = (counts[t.pack] ?? 0) + 1;
  return counts;
}

export function buildReport(corpus: CorpusTurn[]): EvalReport {
  return {
    ran_at: new Date().toISOString(),
    corpus: { turns: corpus.length, packs: packCounts(corpus) },
    layers: [{ layer: "rules", ...scoreRules(corpus) }],
    note: "Rule engine only. The LLM and fused layers need an LLM Gateway key and are run with pnpm eval:live.",
  };
}
