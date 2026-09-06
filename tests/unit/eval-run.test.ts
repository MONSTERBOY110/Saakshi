import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReport, loadCorpus, scoreRules } from "@/lib/eval/corpus";
import { PACK_IDS, getPack } from "@/lib/rules/load";

// The eval harness (prd.md P1-2), run as a test because that is what an eval is: a measurement with
// a threshold. It writes eval/report.json, which the /metrics page reads and the README quotes.
//   pnpm eval
// No API key and no network. The corpus is hand-labelled from the sentence alone, so a failure here
// means the patterns disagree with a compliance reviewer, not that the corpus needs adjusting.

const corpus = loadCorpus();

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

describe("the labelled corpus", () => {
  it("covers both packs with enough turns to mean something", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(60);
    for (const id of PACK_IDS) {
      expect(corpus.filter((t) => t.pack === id).length, id).toBeGreaterThanOrEqual(25);
    }
  });

  it("uses ids that exist in the pack it belongs to", () => {
    for (const t of corpus) {
      const pack = getPack(t.pack);
      const violations = new Set(pack.prohibited.map((p) => p.id));
      const checkpoints = new Set(pack.checkpoints.map((c) => c.id));
      for (const v of t.violations) expect(violations.has(v), `${t.id}: ${v}`).toBe(true);
      for (const c of t.checkpoints) expect(checkpoints.has(c), `${t.id}: ${c}`).toBe(true);
    }
  });

  it("has no duplicate ids and no empty turns", () => {
    expect(new Set(corpus.map((t) => t.id)).size).toBe(corpus.length);
    for (const t of corpus) expect(t.text.trim().length, t.id).toBeGreaterThan(10);
  });

  it("holds enough clean turns to catch a pattern that fires too eagerly", () => {
    const clean = corpus.filter((t) => t.violations.length === 0 && t.checkpoints.length === 0);
    expect(clean.length).toBeGreaterThanOrEqual(10);
  });
});

describe("the rule engine against the corpus", () => {
  it("writes the report the metrics page reads", () => {
    const report = buildReport(corpus);
    writeFileSync(
      join(process.cwd(), "eval", "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    expect(report.layers[0]?.layer).toBe("rules");
    expect(report.corpus.turns).toBe(corpus.length);
  });

  it("meets the accuracy the product depends on", () => {
    const s = scoreRules(corpus);
    const lines = [
      `\n[eval] ${s.turns} labelled turns`,
      `  violations   precision ${pct(s.violations.precision)}  recall ${pct(s.violations.recall)}  f1 ${pct(s.violations.f1)}   tp ${s.violations.tp} fp ${s.violations.fp} fn ${s.violations.fn}`,
      `  checkpoints  precision ${pct(s.checkpoints.precision)}  recall ${pct(s.checkpoints.recall)}  f1 ${pct(s.checkpoints.f1)}   tp ${s.checkpoints.tp} fp ${s.checkpoints.fp} fn ${s.checkpoints.fn}`,
    ];
    if (s.wrong.length > 0) {
      lines.push(`  disagreements (${s.wrong.length}):`);
      for (const w of s.wrong) {
        lines.push(`    ${w.id} ${w.kind}: want [${w.expected}] got [${w.predicted}]  "${w.text}"`);
      }
    }
    console.log(lines.join("\n"));

    // A false positive interrupts an honest advisor in front of a customer, which is the worse
    // failure, so precision is held higher than recall.
    expect(s.violations.precision).toBeGreaterThanOrEqual(0.9);
    expect(s.violations.recall).toBeGreaterThanOrEqual(0.8);
    expect(s.checkpoints.precision).toBeGreaterThanOrEqual(0.9);
    expect(s.checkpoints.recall).toBeGreaterThanOrEqual(0.8);
  });
});
