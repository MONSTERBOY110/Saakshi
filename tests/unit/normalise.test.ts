import { describe, expect, it } from "vitest";
import { hasDevanagari, hasLatin, languageTag, normalise } from "@/lib/rules/normalise";

describe("normalise", () => {
  it("lower-cases, strips punctuation to spaces and collapses whitespace", () => {
    expect(normalise("  Returns are GUARANTEED,   twelve percent!  ")).toBe(
      "returns are guaranteed twelve percent",
    );
  });

  it("turns hyphens into spaces so lock-in and market-linked match one form", () => {
    expect(normalise("This is a unit-linked plan with a 5-year lock-in.")).toBe(
      "this is a unit linked plan with a 5 year lock in",
    );
  });

  it("keeps digits and percent signs and joins digit groups", () => {
    expect(normalise("You pay ₹50,000 every year; values at 4% and 8%.")).toBe(
      "you pay 50000 every year values at 4% and 8%",
    );
  });

  it("keeps Devanagari letters with their vowel signs and drops the danda", () => {
    expect(normalise("पाँच साल, five years, उसके बाद निकल सकती हूँ।")).toBe(
      "पाँच साल five years उसके बाद निकल सकती हूँ",
    );
  });

  it("removes apostrophes instead of splitting words", () => {
    expect(normalise("Don't worry, it's guaranteed")).toBe("dont worry its guaranteed");
  });

  it("applies NFC so composed and decomposed Devanagari compare equal", () => {
    expect(normalise("गारंटी")).toBe(normalise("गारंटी".normalize("NFD")));
  });
});

describe("language tag", () => {
  it("detects scripts", () => {
    expect(hasDevanagari("पाँच साल")).toBe(true);
    expect(hasDevanagari("paanch saal")).toBe(false);
    expect(hasLatin("पाँच साल five")).toBe(true);
  });

  it("returns hi+en for mixed-script turns and the language code otherwise", () => {
    expect(languageTag("पांच साल, five years", "hi")).toBe("hi+en");
    expect(languageTag("Is my paisa kab nikal sakti hoon", "en")).toBe("en");
    expect(languageTag("उसके बाद निकल सकती हूँ", "hi")).toBe("hi");
    expect(languageTag("hello", undefined)).toBe("en");
    expect(languageTag("hello", "et")).toBe("en");
  });
});
