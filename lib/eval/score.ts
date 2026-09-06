// Precision and recall over labelled turns (prd.md P1-2). Pure arithmetic, no I/O, so the numbers
// that reach the metrics page and the README are computed somewhere that can be tested.

export type Pair = { expected: string[]; predicted: string[] };

export type Score = {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  /** How often each label was predicted when it was not there. */
  falsePositives: Record<string, number>;
  /** How often each label was there and missed. */
  falseNegatives: Record<string, number>;
};

/**
 * Set comparison per turn: a label predicted twice counts once, and a corpus with nothing to find
 * scores 1 rather than dividing by zero. Nothing to find is not a failure to find it.
 */
export function scoreLabels(pairs: Pair[]): Score {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  const falsePositives: Record<string, number> = {};
  const falseNegatives: Record<string, number> = {};

  for (const pair of pairs) {
    const expected = new Set(pair.expected);
    const predicted = new Set(pair.predicted);
    for (const label of predicted) {
      if (expected.has(label)) {
        tp += 1;
      } else {
        fp += 1;
        falsePositives[label] = (falsePositives[label] ?? 0) + 1;
      }
    }
    for (const label of expected) {
      if (!predicted.has(label)) {
        fn += 1;
        falseNegatives[label] = (falseNegatives[label] ?? 0) + 1;
      }
    }
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1, falsePositives, falseNegatives };
}

export type Scored = {
  id: string;
  pack: string;
  text: string;
  expected: string[];
  predicted: string[];
  kind: "violation" | "checkpoint";
};

export type Summary = {
  turns: number;
  violations: Score;
  checkpoints: Score;
  /** Every turn where the prediction and the label disagreed, so a bad pattern can be read. */
  wrong: Scored[];
};

/**
 * Violations and checkpoints are scored apart because they fail in opposite directions: a missed
 * violation lets a customer be misled, while a missed checkpoint only means the nudge reads it out.
 */
export function summarise(rows: Scored[]): Summary {
  const of = (kind: Scored["kind"]) => rows.filter((r) => r.kind === kind);
  const ids = new Set(rows.map((r) => r.id));
  return {
    turns: ids.size,
    violations: scoreLabels(of("violation")),
    checkpoints: scoreLabels(of("checkpoint")),
    wrong: rows.filter((r) => !sameSet(r.expected, r.predicted)),
  };
}

function sameSet(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const x of left) if (!right.has(x)) return false;
  return true;
}
