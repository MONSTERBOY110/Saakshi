import { describe, expect, it } from "vitest";
import { getPack } from "@/lib/rules/load";
import {
  buildCalibrationLine,
  buildGreeting,
  buildKeyterms,
  buildSttPrompt,
  type SessionSetup,
} from "@/lib/session/keyterms";

const pack = getPack("insurance-ulip-in");
const setup: SessionSetup = {
  packId: "insurance-ulip-in",
  advisorName: "Rahul",
  customerName: "Mrs. Sharma",
  productName: "SecureGrowth ULIP",
  productTerms: ["SecureGrowth", "Balanced Fund", "  "],
  judgeSolo: false,
};

describe("keyterms and prompts", () => {
  it("puts names, product and terms first, then the pack terms, deduplicated and capped", () => {
    const terms = buildKeyterms(setup, pack);
    expect(terms.slice(0, 5)).toEqual([
      "Rahul",
      "Mrs. Sharma",
      "SecureGrowth ULIP",
      "SecureGrowth",
      "Balanced Fund",
    ]);
    expect(terms).toContain("lock-in");
    expect(new Set(terms).size).toBe(terms.length);
    expect(terms.length).toBeLessThanOrEqual(100);
    expect(terms.every((t) => t.length <= 50 && t.trim() === t && t.length > 0)).toBe(true);
  });

  it("builds an STT prompt from the pack scenario plus the people and product, under 1750 chars", () => {
    const prompt = buildSttPrompt(setup, pack);
    expect(prompt.startsWith(pack.scenario_prompt)).toBe(true);
    expect(prompt).toContain("Rahul");
    expect(prompt).toContain("Mrs. Sharma");
    expect(prompt).toContain("SecureGrowth ULIP");
    expect(prompt.length).toBeLessThanOrEqual(1750);
  });

  it("speaks a greeting and calibration lines that ask for full sentences and stay speakable", () => {
    const greeting = buildGreeting(setup);
    expect(greeting).toContain("Saakshi");
    expect(greeting).toContain("Rahul");
    expect(greeting).toMatch(/full name/);
    const askCustomer = buildCalibrationLine(setup, "customer");
    expect(askCustomer).toContain("Mrs. Sharma");
    expect(askCustomer).toMatch(/full name/);
    const done = buildCalibrationLine(setup, "done");
    expect(done).toMatch(/listen/i);
    for (const line of [greeting, askCustomer, done]) {
      expect(line).not.toMatch(/[!*_#`]/);
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(25);
    }
  });
});
