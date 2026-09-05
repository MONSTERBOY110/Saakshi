import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compilePack, PackSchema } from "@/lib/rules/pack";

const packsDir = join(process.cwd(), "packs");
const packFiles = readdirSync(packsDir).filter((f) => f.endsWith(".json"));

describe("protocol pack schema", () => {
  it.each(packFiles)("%s validates and compiles", (file) => {
    const json = JSON.parse(readFileSync(join(packsDir, file), "utf8"));
    const parsed = PackSchema.safeParse(json);
    expect(parsed.success, parsed.success ? "" : parsed.error.message).toBe(true);
    if (!parsed.success) return;
    const compiled = compilePack(parsed.data);
    expect(compiled.checkpoints.length).toBeGreaterThan(0);
    for (const c of compiled.checkpoints) expect(c.regexes.length).toBe(c.patterns.length);
  });

  it("the ULIP pack has the eight required disclosures and six prohibited claims", () => {
    const json = JSON.parse(readFileSync(join(packsDir, "insurance-ulip-in.json"), "utf8"));
    const pack = PackSchema.parse(json);
    expect(pack.checkpoints.map((c) => c.id)).toEqual([
      "premium_and_term",
      "policy_term",
      "lock_in_5y",
      "charges",
      "market_risk",
      "benefit_illustration_4_8",
      "surrender_value",
      "free_look_30",
    ]);
    expect(pack.prohibited.map((p) => p.id)).toEqual([
      "guaranteed_returns",
      "like_fd",
      "no_charges",
      "withdraw_anytime",
      "tax_free_forever",
      "pressure",
    ]);
    expect(pack.prohibited.find((p) => p.id === "guaranteed_returns")?.severity).toBe("critical");
    expect(pack.prohibited.find((p) => p.id === "withdraw_anytime")?.severity).toBe("critical");
    for (const p of pack.prohibited) {
      expect(p.correction.split(/\s+/).length, p.id).toBeLessThanOrEqual(20);
      expect(p.correction, p.id).not.toMatch(/[!*_#]/);
    }
    expect(pack.demo_script.length).toBeGreaterThanOrEqual(8);
  });

  it("rejects duplicate ids, bad regexes, over-long prompts and long corrections", () => {
    const base = {
      id: "test-pack",
      version: "1.0.0",
      title: "t",
      jurisdiction: "IN",
      keyterms: ["a"],
      scenario_prompt: "x",
      checkpoints: [
        {
          id: "a",
          label: "A",
          required_speaker: "advisor",
          patterns: ["a"],
          citation: cite(),
          hint: "h",
        },
      ],
      prohibited: [],
      teachback_topics: [],
      demo_script: [],
    };
    expect(PackSchema.safeParse(base).success).toBe(true);
    const dup = { ...base, checkpoints: [base.checkpoints[0], base.checkpoints[0]] };
    expect(PackSchema.safeParse(dup).success).toBe(false);
    const longPrompt = { ...base, scenario_prompt: "p".repeat(1751) };
    expect(PackSchema.safeParse(longPrompt).success).toBe(false);
    const longCorrection = {
      ...base,
      prohibited: [
        {
          id: "p",
          label: "P",
          severity: "high",
          patterns: ["p"],
          citation: cite(),
          correction: Array.from({ length: 21 }, () => "word").join(" "),
        },
      ],
    };
    expect(PackSchema.safeParse(longCorrection).success).toBe(false);
    const badRegex = {
      ...base,
      checkpoints: [{ ...base.checkpoints[0], patterns: ["(unclosed"] }],
    };
    expect(() => compilePack(PackSchema.parse(badRegex))).toThrow(/checkpoint a/);
  });
});

function cite() {
  return { authority: "IRDAI", instrument: "Test", clause: "1" };
}
