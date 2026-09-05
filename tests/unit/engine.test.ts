import { describe, expect, it } from "vitest";
import { evaluateTurn, type RuleTurn } from "@/lib/rules/engine";
import { getPack } from "@/lib/rules/load";

const pack = getPack("insurance-ulip-in");
const adv = (order: number, text: string): RuleTurn => ({ order, role: "advisor", text });
const cus = (order: number, text: string): RuleTurn => ({ order, role: "customer", text });
const ids = (m: { id: string }[]) => m.map((x) => x.id);

describe("checkpoints", () => {
  it("tick from advisor turns in English", () => {
    const r = evaluateTurn(
      pack,
      adv(
        5,
        "You pay a premium of ₹50,000 every year for 10 years, and the policy term is 15 years.",
      ),
    );
    expect(ids(r.checkpoints)).toEqual(expect.arrayContaining(["premium_and_term", "policy_term"]));
    expect(r.checkpoints[0]?.quote).toBe(
      "You pay a premium of ₹50,000 every year for 10 years, and the policy term is 15 years.",
    );
    expect(r.checkpoints[0]?.turnOrder).toBe(5);
  });

  it("tick from Roman Hindi and Devanagari forms", () => {
    expect(
      ids(evaluateTurn(pack, adv(1, "Paanch saal tak lock rahega, nikal nahi sakte.")).checkpoints),
    ).toContain("lock_in_5y");
    expect(ids(evaluateTurn(pack, adv(2, "पाँच साल का लॉक इन है।")).checkpoints)).toContain(
      "lock_in_5y",
    );
    expect(ids(evaluateTurn(pack, adv(3, "Isme kuch शुल्क lagte hain.")).checkpoints)).toContain(
      "charges",
    );
    expect(
      ids(evaluateTurn(pack, adv(4, "Paisa बाज़ार par depend karta hai.")).checkpoints),
    ).toContain("market_risk");
    expect(
      ids(
        evaluateTurn(pack, adv(5, "Aap tees din ke andar policy wapas kar sakte hain."))
          .checkpoints,
      ),
    ).toContain("free_look_30");
  });

  it("never tick from customer turns", () => {
    const r = evaluateTurn(pack, cus(7, "Premium kitna hai? Policy term kya hai?"));
    expect(r.checkpoints).toEqual([]);
  });

  it("do nothing while the role is unknown", () => {
    const r = evaluateTurn(pack, {
      order: 0,
      role: undefined,
      text: "There is a five year lock in.",
    });
    expect(r.checkpoints).toEqual([]);
    expect(r.violations).toEqual([]);
  });

  it("use the two-turn window for a sentence split across advisor turns", () => {
    const prev = adv(10, "You also get a free look period.");
    const cur = adv(11, "It is thirty days to return the policy.");
    const r = evaluateTurn(pack, cur, prev);
    const fl = r.checkpoints.find((m) => m.id === "free_look_30");
    expect(fl).toBeDefined();
    expect(fl?.turnOrder).toBe(11);
  });

  it("do not re-tick a checkpoint that lives entirely in the previous turn", () => {
    const prev = adv(20, "There is a five year lock in.");
    const cur = adv(21, "Charges apply every year.");
    const r = evaluateTurn(pack, cur, prev);
    expect(ids(r.checkpoints)).toContain("charges");
    expect(ids(r.checkpoints)).not.toContain("lock_in_5y");
  });
});

describe("prohibited claims", () => {
  it("flag guaranteed returns as critical on the demo line", () => {
    const r = evaluateTurn(pack, adv(9, "Anytime, madam, and the returns are guaranteed, 12%."));
    const g = r.violations.find((v) => v.id === "guaranteed_returns");
    expect(g?.severity).toBe("critical");
    expect(g?.quote).toBe("Anytime, madam, and the returns are guaranteed, 12%.");
  });

  it("flag withdraw_anytime across the customer question and advisor answer", () => {
    const prev = cus(8, "Is my paisa cab nikal sakhti hoon?");
    const cur = adv(9, "Anytime, madam, and the returns are guaranteed, 12%.");
    const r = evaluateTurn(pack, cur, prev);
    const w = r.violations.find((v) => v.id === "withdraw_anytime");
    expect(w?.windowed).toBe(true);
    expect(w?.turnOrder).toBe(9);
  });

  it("flag Roman Hindi and Devanagari guarantees", () => {
    expect(
      ids(evaluateTurn(pack, adv(1, "Pakka return milega, tension mat lo.")).violations),
    ).toContain("guaranteed_returns");
    expect(ids(evaluateTurn(pack, adv(2, "Baarah percent guaranteed hai.")).violations)).toContain(
      "guaranteed_returns",
    );
    expect(ids(evaluateTurn(pack, adv(3, "गारंटीड रिटर्न मिलेगा।")).violations)).toContain(
      "guaranteed_returns",
    );
  });

  it("stay silent on negated guarantees", () => {
    for (const text of [
      "Returns are not guaranteed.",
      "Sorry, let me correct that. Returns are not guaranteed.",
      "Guaranteed nahi hai, market par depend karta hai.",
      "Koi guarantee nahi hai.",
      "गारंटी नहीं है।",
      "Returns on a market-linked plan cannot be called guaranteed.",
    ]) {
      expect(ids(evaluateTurn(pack, adv(1, text)).violations), text).not.toContain(
        "guaranteed_returns",
      );
    }
  });

  it("flag the other prohibited claims", () => {
    expect(
      ids(evaluateTurn(pack, adv(1, "It is just like an FD, but better.")).violations),
    ).toContain("like_fd");
    expect(ids(evaluateTurn(pack, adv(2, "FD jaisa hi hai madam.")).violations)).toContain(
      "like_fd",
    );
    expect(ids(evaluateTurn(pack, adv(3, "There are no charges at all.")).violations)).toContain(
      "no_charges",
    );
    expect(ids(evaluateTurn(pack, adv(4, "Koi charge nahi lagega.")).violations)).toContain(
      "no_charges",
    );
    expect(ids(evaluateTurn(pack, adv(5, "It is completely tax free.")).violations)).toContain(
      "tax_free_forever",
    );
    expect(
      ids(evaluateTurn(pack, adv(6, "This offer ends today, so sign now.")).violations),
    ).toContain("pressure");
    expect(
      ids(evaluateTurn(pack, adv(7, "You can withdraw the money anytime.")).violations),
    ).toContain("withdraw_anytime");
  });

  it("record a prohibited phrase from the customer as a belief, not a violation", () => {
    const r = evaluateTurn(pack, cus(3, "Matlab returns guaranteed hai na?"));
    expect(r.violations).toEqual([]);
    expect(ids(r.customerBeliefs)).toContain("guaranteed_returns");
  });

  it("does not flag ordinary disclosure sentences", () => {
    for (const text of [
      "There are charges, including premium allocation and fund management charges.",
      "The benefit illustration shows values at 4% and 8%.",
      "You also have a 30-day free look period to return the policy.",
      "The surrender value applies after the lock-in.",
    ]) {
      expect(evaluateTurn(pack, adv(1, text)).violations, text).toEqual([]);
    }
  });
});

describe("the recorded golden script", () => {
  // Transcripts as Streaming STT returned them for the two-voice WAV on 2026-09-05.
  const script: RuleTurn[] = [
    adv(0, "Good morning, Mrs. Sharma."),
    adv(1, "My name is Rahul."),
    cus(2, "Namaste."),
    cus(3, "My name is Mrs. Sharma."),
    adv(4, "This is a unit-linked insurance plan."),
    adv(
      5,
      "You pay a premium of ₹50,000 every year for 10 years, and the policy term is 15 years.",
    ),
    adv(6, "The money goes into market-linked funds, so the fund value depends on the market."),
    adv(7, "There is a 5-year lock-in."),
    cus(8, "Is my paisa cab nikal sakhti hoon?"),
    adv(9, "Anytime, madam, and the returns are guaranteed, 12%."),
    adv(10, "Sorry, let me correct that."),
    adv(11, "Returns are not guaranteed."),
    adv(12, "There are charges, including premium allocation and fund management charges."),
    adv(13, "The benefit illustration shows values at 4% and 8%."),
    adv(14, "The surrender value applies after the lock-in."),
    adv(15, "Saakshi, verify."),
    adv(16, "You also have a 30-day free look period to return the policy."),
    cus(17, "पांच साल, five years, उसके बाद निकल सकती हूँ।"),
  ];

  it("ticks all eight checkpoints and flags exactly the two planted violations", () => {
    const seenCheckpoints = new Set<string>();
    const violations: string[] = [];
    script.forEach((turn, i) => {
      const r = evaluateTurn(pack, turn, script[i - 1]);
      for (const c of r.checkpoints) seenCheckpoints.add(c.id);
      for (const v of r.violations) violations.push(`${v.id}@${v.turnOrder}`);
    });
    expect([...seenCheckpoints].sort()).toEqual(pack.checkpoints.map((c) => c.id).sort());
    expect(violations.sort()).toEqual(["guaranteed_returns@9", "withdraw_anytime@9"]);
  });
});
