import { describe, expect, it } from "vitest";
import { devanagariToRoman, hasDevanagari, loosen } from "@/lib/session/devanagari";
import { observeFinalTurn, initialRoles, whoseName } from "@/lib/session/roles";

const names = { advisor: "Rahul", customer: "Mrs. Sharma" };

describe("hasDevanagari", () => {
  it("spots Devanagari and leaves plain Roman alone", () => {
    expect(hasDevanagari("माय नेम इस मिसेज शर्मा")).toBe(true);
    expect(hasDevanagari("Paanch saal, five years")).toBe(false);
    expect(hasDevanagari("पांच साल, five years")).toBe(true);
  });
});

describe("devanagariToRoman", () => {
  it("reads a name closely enough to recognise it", () => {
    expect(loosen(devanagariToRoman("शर्मा"))).toContain("sharma");
    expect(loosen(devanagariToRoman("राहुल"))).toContain("rahul");
  });

  it("keeps Latin text as it is, so Hinglish stays readable", () => {
    expect(devanagariToRoman("पांच साल, five years")).toContain("five years");
  });

  it("drops the inherent vowel after a virama", () => {
    // क् is a bare k, not "ka".
    expect(devanagariToRoman("क्या")).toBe("kyaa");
  });

  it("writes the nasal marks as n", () => {
    // A final consonant keeps its inherent vowel here; no schwa deletion is attempted, because
    // loosen() is what makes the comparison forgiving.
    expect(devanagariToRoman("पांच")).toBe("paancha");
    expect(loosen(devanagariToRoman("पांच"))).toBe("pancha");
  });
});

describe("loosen", () => {
  it("makes doubled vowels and punctuation stop mattering", () => {
    expect(loosen("Shaarmaa")).toBe("sharma");
    expect(loosen("Mrs. Sharma")).toBe("mrs sharma");
  });
});

describe("whoseName with Devanagari", () => {
  it("binds the customer when her name arrives in Devanagari", () => {
    // Seen on a live golden run: the customer's English line came back in Devanagari.
    expect(whoseName("माय नेम इस मिसेज शर्मा", names)).toBe("customer");
  });

  it("binds the advisor when his name arrives in Devanagari", () => {
    expect(whoseName("मेरा नाम राहुल है", names)).toBe("advisor");
  });

  it("still prefers a plain Roman match", () => {
    expect(whoseName("Namaste. My name is Mrs. Sharma.", names)).toBe("customer");
    expect(whoseName("Good morning. My name is Rahul.", names)).toBe("advisor");
  });

  it("stays undecided when both names or neither are said", () => {
    expect(whoseName("राहुल और शर्मा दोनों", names)).toBeUndefined();
    expect(whoseName("यह एक अच्छी योजना है", names)).toBeUndefined();
  });
});

describe("calibration on the run that failed", () => {
  it("binds the customer to the label that said her name in Devanagari", () => {
    // Speaker A spoke first and said the customer's name; order alone would have made A the advisor.
    const first = observeFinalTurn(
      initialRoles(),
      { label: "A", text: "माय नेम इस मिसेज शर्मा" },
      names,
    );
    expect(first.bound).toBe("customer");
    expect(first.state.customer).toBe("A");

    const second = observeFinalTurn(
      first.state,
      { label: "B", text: "This is a unit-linked insurance plan." },
      names,
    );
    expect(second.state.advisor).toBe("B");
    expect(second.state.step).toBe("done");
  });
});
