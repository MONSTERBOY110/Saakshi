import { describe, expect, it } from "vitest";
import { scoreLabels, summarise, type Scored } from "@/lib/eval/score";

// Precision and recall over labelled turns. The numbers on the metrics page and in the README come
// from here, so the arithmetic is tested rather than trusted.

describe("scoreLabels", () => {
  it("counts a perfect prediction as all true positives", () => {
    const s = scoreLabels([{ expected: ["a", "b"], predicted: ["b", "a"] }]);
    expect(s).toMatchObject({ tp: 2, fp: 0, fn: 0 });
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
    expect(s.f1).toBe(1);
  });

  it("counts something predicted that was not there as a false positive", () => {
    const s = scoreLabels([{ expected: [], predicted: ["a"] }]);
    expect(s).toMatchObject({ tp: 0, fp: 1, fn: 0 });
    expect(s.precision).toBe(0);
    // Nothing was there to find, so recall is not a failure.
    expect(s.recall).toBe(1);
  });

  it("counts something missed as a false negative", () => {
    const s = scoreLabels([{ expected: ["a"], predicted: [] }]);
    expect(s).toMatchObject({ tp: 0, fp: 0, fn: 1 });
    expect(s.recall).toBe(0);
    expect(s.precision).toBe(1);
  });

  it("ignores a duplicate prediction rather than counting it twice", () => {
    const s = scoreLabels([{ expected: ["a"], predicted: ["a", "a"] }]);
    expect(s).toMatchObject({ tp: 1, fp: 0, fn: 0 });
  });

  it("adds up across many turns", () => {
    const s = scoreLabels([
      { expected: ["a"], predicted: ["a"] },
      { expected: ["b"], predicted: ["c"] },
      { expected: [], predicted: [] },
    ]);
    expect(s).toMatchObject({ tp: 1, fp: 1, fn: 1 });
    expect(s.precision).toBeCloseTo(0.5);
    expect(s.recall).toBeCloseTo(0.5);
    expect(s.f1).toBeCloseTo(0.5);
  });

  it("calls a corpus with nothing to find perfect rather than dividing by zero", () => {
    const s = scoreLabels([{ expected: [], predicted: [] }]);
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
    expect(s.f1).toBe(1);
  });

  it("reports which labels were wrong, so a bad pattern can be found", () => {
    const s = scoreLabels([
      { expected: ["a"], predicted: ["b"] },
      { expected: ["a"], predicted: [] },
    ]);
    expect(s.falsePositives).toEqual({ b: 1 });
    expect(s.falseNegatives).toEqual({ a: 2 });
  });
});

describe("summarise", () => {
  const rows: Scored[] = [
    { id: "1", pack: "p", text: "t", expected: ["a"], predicted: ["a"], kind: "violation" },
    { id: "2", pack: "p", text: "t", expected: [], predicted: ["a"], kind: "violation" },
    { id: "3", pack: "p", text: "t", expected: ["c"], predicted: ["c"], kind: "checkpoint" },
  ];

  it("scores violations and checkpoints separately, because they fail differently", () => {
    const out = summarise(rows);
    expect(out.violations.tp).toBe(1);
    expect(out.violations.fp).toBe(1);
    expect(out.checkpoints.tp).toBe(1);
    expect(out.checkpoints.fp).toBe(0);
  });

  it("counts the turns it scored", () => {
    expect(summarise(rows).turns).toBe(3);
  });

  it("lists the turns that went wrong so they can be read", () => {
    const wrong = summarise(rows).wrong;
    expect(wrong.map((w) => w.id)).toEqual(["2"]);
  });
});
