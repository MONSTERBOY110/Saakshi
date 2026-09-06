import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getPack, PACK_IDS } from "@/lib/rules/load";
import { buildKeyterms, DEFAULT_SETUP } from "@/lib/session/keyterms";
import { rebuildBoard, boardSummary } from "@/lib/session/board";
import type { StoredTurn } from "@/lib/session/transcript";

// A second protocol pack is only real if the same engine, with no changes, enforces it. This drives
// the loan pack's own demo script through the rule engine and checks that the disclosures tick, the
// planted no-cost-EMI claim is flagged critical, and the later correction closes it.

const pack = getPack("loan-kfs-in");

function turn(order: number, text: string, role: "advisor" | "customer" = "advisor"): StoredTurn {
  return {
    order,
    text,
    final: true,
    formatted: true,
    speakerLabel: role === "advisor" ? "A" : "B",
    role,
    language: "en",
    startMs: order * 4000,
    endMs: order * 4000 + 3200,
    words: [],
    revised: false,
    pending: false,
  };
}

/** The pack's own demo script, as the room would hear it. */
const script = pack.demo_script.map((line, i) => turn(i, line.text_en));

describe("the loan pack enforces itself", () => {
  it("ticks every disclosure its own demo script makes", () => {
    const board = rebuildBoard(pack, script);
    const met = board.checkpoints.filter((c) => c.status !== "pending").map((c) => c.id);
    // The script is written to cover all eight; anything missing is a pattern that does not fire.
    expect(met.sort()).toEqual(pack.checkpoints.map((c) => c.id).sort());
    expect(boardSummary(board).met).toBe(8);
  });

  it("flags the planted no cost EMI claim as critical", () => {
    const board = rebuildBoard(pack, script);
    const flagged = board.violations.find((v) => v.id === "zero_cost_emi");
    expect(flagged, "zero_cost_emi should fire on line l04").toBeDefined();
    expect(flagged?.severity).toBe("critical");
    expect(flagged?.evidence.quote).toMatch(/no cost EMI/i);
  });

  it("marks the claim corrected once the advisor states the real APR", () => {
    const board = rebuildBoard(pack, script);
    const flagged = board.violations.find((v) => v.id === "zero_cost_emi");
    expect(flagged?.status).toBe("corrected");
  });

  it("catches the other prohibited claims when they are actually said", () => {
    const cases: Array<[string, string]> = [
      ["guaranteed_approval", "Your approval is guaranteed, madam, one hundred percent."],
      ["no_hidden_charges", "There are no hidden charges at all in this loan."],
      ["forced_insurance", "Insurance is compulsory with this loan, you must take it."],
      ["no_credit_impact", "Your CIBIL score will not be affected by this at all."],
      ["pressure", "This offer closes today, so please sign now."],
    ];
    for (const [id, text] of cases) {
      const board = rebuildBoard(pack, [turn(0, text)]);
      expect(
        board.violations.map((v) => v.id),
        `${id} should fire on: ${text}`,
      ).toContain(id);
    }
  });

  it("does not flag an advisor who states the cost honestly", () => {
    const clean = [
      turn(0, "The annual percentage rate is fifteen point eight percent, including every charge."),
      turn(1, "There is a processing fee of nine thousand rupees."),
      turn(2, "Insurance is optional. You choose whether to take it."),
      turn(3, "Sanction is subject to credit appraisal, so nothing is approved yet."),
      turn(4, "Take your time, there is no need to decide today."),
    ];
    const board = rebuildBoard(pack, clean);
    expect(board.violations.map((v) => v.id)).toEqual([]);
  });

  it("reads Hinglish the way the room actually speaks it", () => {
    const board = rebuildBoard(pack, [
      turn(0, "Madam, byaj nahi lagega, bilkul free hai."),
      turn(1, "EMI baarah hazaar har mahine, adtalis mahine tak."),
    ]);
    expect(board.violations.map((v) => v.id)).toContain("zero_cost_emi");
    expect(board.checkpoints.find((c) => c.id === "loan_amount_and_tenure")?.status).not.toBe(
      "pending",
    );
  });

  it("keeps every spoken correction short enough to say over a conversation", () => {
    for (const p of pack.prohibited) {
      expect(p.correction.split(/\s+/).length, p.id).toBeLessThanOrEqual(20);
      expect(p.correction).not.toMatch(/[!*_#`]/);
    }
  });

  it("gives every checkpoint a teach-back topic that exists", () => {
    const topics = new Set(pack.teachback_topics.map((t) => t.id));
    for (const c of pack.checkpoints) {
      expect(c.teachback_topic, `${c.id} has no teach-back topic`).toBeDefined();
      expect(topics.has(c.teachback_topic as string), `${c.teachback_topic} is not a topic`).toBe(
        true,
      );
    }
  });

  it("names every card short enough for the tabla to hold it", () => {
    for (const c of pack.checkpoints) {
      const name = c.short_label ?? c.label;
      expect(name.length, `${c.id}: ${name}`).toBeLessThanOrEqual(24);
    }
  });
});

describe("switching protocol packs", () => {
  it("both packs are offered and each names what is being sold", () => {
    expect(PACK_IDS).toEqual(["insurance-ulip-in", "loan-kfs-in"]);
    expect(getPack("insurance-ulip-in").product_default).toBe("ULIP");
    expect(getPack("loan-kfs-in").product_default).toBe("Personal loan");
  });

  it("every pack ships the audio judge-solo needs for its own demo script", () => {
    for (const id of PACK_IDS) {
      const pack = getPack(id);
      for (const line of pack.demo_script) {
        const file = join(process.cwd(), "public", "demo", "advisor", id, `${line.id}.pcm`);
        expect(existsSync(file), `${id}/${line.id}.pcm is missing`).toBe(true);
      }
    }
  });

  it("keyterms follow the pack, so the recogniser hears its vocabulary", () => {
    const ulip = buildKeyterms({ ...DEFAULT_SETUP }, getPack("insurance-ulip-in"));
    const loan = buildKeyterms(
      { ...DEFAULT_SETUP, packId: "loan-kfs-in", productName: "Personal loan" },
      getPack("loan-kfs-in"),
    );
    expect(ulip.join(" ").toLowerCase()).toContain("surrender value");
    expect(loan.join(" ").toLowerCase()).toContain("foreclosure");
    expect(loan.join(" ").toLowerCase()).not.toContain("surrender value");
  });
});
