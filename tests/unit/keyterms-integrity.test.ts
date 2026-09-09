import { describe, expect, it } from "vitest";
import { evaluateTurn } from "@/lib/rules/engine";
import { getPack, PACK_IDS } from "@/lib/rules/load";
import { normalise } from "@/lib/rules/normalise";
import {
  buildKeyterms,
  DEFAULT_SETUP,
  identityKeyterms,
  isKeytermsMode,
  ruleKeyterms,
  type SessionSetup,
} from "@/lib/session/keyterms";

// Keyterms integrity (docs/decisions.md, 2026-09-09). The recogniser's output is the evidence the
// rule engine judges, so the recogniser must never be biased toward a phrase that would, on its
// own, complete a disclosure, a prohibited claim or a correction. Otherwise a mishearing snaps to
// the answer key and the certificate attests to something nobody said. These tests make that a
// property of every pack rather than a habit.

const setup: SessionSetup = {
  ...DEFAULT_SETUP,
  advisorName: "Rahul",
  customerName: "Mrs. Sharma",
  productName: "SecureGrowth ULIP",
  productTerms: ["SecureGrowth", "Balanced Fund"],
};

/** A term spoken alone by the advisor, as its own finalized turn, and also inside a neutral sentence. */
function completesAnyRule(packId: string, term: string): string[] {
  const pack = getPack(packId);
  const hits: string[] = [];
  for (const text of [term, `I want to mention ${term} to you today.`]) {
    const e = evaluateTurn(pack, { order: 1, role: "advisor", text });
    for (const m of e.checkpoints) hits.push(`checkpoint:${m.id}`);
    for (const m of e.violations) hits.push(`prohibited:${m.id}`);
    for (const id of e.corrections) hits.push(`correction:${id}`);
  }
  return hits;
}

describe("keyterms integrity: identity vocabulary can never be evidence", () => {
  it.each(PACK_IDS)("%s: no identity keyterm completes a rule on its own", (packId) => {
    const pack = getPack(packId);
    const offenders = pack.keyterms
      .map((term) => ({ term, hits: completesAnyRule(packId, term) }))
      .filter((x) => x.hits.length > 0);
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  it.each(PACK_IDS)(
    "%s: identity keyterms built for a session complete no rule either",
    (packId) => {
      const pack = getPack(packId);
      const terms = identityKeyterms({ ...setup, packId, productName: pack.product_default }, pack);
      const offenders = terms.filter((t) => completesAnyRule(packId, t).length > 0);
      expect(offenders).toEqual([]);
    },
  );

  it.each(PACK_IDS)("%s: the rule vocabulary is where the evidence words live", (packId) => {
    const pack = getPack(packId);
    // Every checkpoint and prohibited pattern is written for normalised text; the rule vocabulary
    // must at least overlap that text, otherwise the split was done in the wrong direction.
    const rule = ruleKeyterms(pack).map(normalise);
    const patternText = [
      ...pack.checkpoints.flatMap((c) => c.patterns),
      ...pack.prohibited.flatMap((p) => p.patterns),
    ]
      .join(" ")
      .toLowerCase();
    const overlapping = rule.filter((t) =>
      t.split(" ").some((w) => w.length > 3 && patternText.includes(w)),
    );
    expect(overlapping.length).toBeGreaterThan(0);
    // And no identity term is duplicated in the rule list.
    const identity = new Set(pack.keyterms.map(normalise));
    expect(rule.filter((t) => identity.has(t))).toEqual([]);
  });
});

describe("keyterms modes", () => {
  const pack = getPack("insurance-ulip-in");

  it("identity is the default and carries names, product and pack identity terms only", () => {
    const terms = buildKeyterms({ ...setup, keytermsMode: undefined }, pack);
    expect(terms.slice(0, 5)).toEqual([
      "Rahul",
      "Mrs. Sharma",
      "SecureGrowth ULIP",
      "SecureGrowth",
      "Balanced Fund",
    ]);
    for (const t of pack.keyterms) expect(terms).toContain(t);
    for (const t of pack.rule_keyterms) expect(terms).not.toContain(t);
  });

  it("full adds the rule vocabulary after the identity terms, deduplicated and capped", () => {
    const terms = buildKeyterms({ ...setup, keytermsMode: "full" }, pack);
    const identity = buildKeyterms({ ...setup, keytermsMode: "identity" }, pack);
    expect(terms.slice(0, identity.length)).toEqual(identity);
    for (const t of pack.rule_keyterms) expect(terms).toContain(t);
    expect(new Set(terms).size).toBe(terms.length);
    expect(terms.length).toBeLessThanOrEqual(100);
  });

  it("none sends nothing, so the recogniser runs unbiased", () => {
    expect(buildKeyterms({ ...setup, keytermsMode: "none" }, pack)).toEqual([]);
  });

  it("recognises the three modes and nothing else", () => {
    expect(isKeytermsMode("identity")).toBe(true);
    expect(isKeytermsMode("full")).toBe(true);
    expect(isKeytermsMode("none")).toBe(true);
    expect(isKeytermsMode("all")).toBe(false);
    expect(isKeytermsMode(null)).toBe(false);
  });
});
