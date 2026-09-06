import { describe, expect, it } from "vitest";
import { getPack } from "@/lib/rules/load";
import { emptyBoard } from "@/lib/session/board";
import {
  ACK_WINDOW_MS,
  composeIntervention,
  composeNudge,
  wordCount,
} from "@/lib/session/intervention";
import type { SessionSetup } from "@/lib/session/keyterms";

const pack = getPack("insurance-ulip-in");
const setup: SessionSetup = {
  packId: pack.id,
  advisorName: "Rahul",
  customerName: "Mrs. Sharma",
  productName: "ULIP",
  productTerms: [],
  judgeSolo: false,
};

describe("composeIntervention", () => {
  it("addresses the advisor, speaks the correction, and asks the customer to note it", () => {
    const line = composeIntervention(
      setup,
      "Returns on a market-linked plan cannot be called guaranteed.",
    );
    expect(line).toBe(
      "Rahul, a quick flag. Returns on a market-linked plan cannot be called guaranteed. Mrs. Sharma, please note.",
    );
    expect(wordCount(line)).toBeLessThanOrEqual(25);
    expect(line).not.toMatch(/[!*_#`]/);
  });

  it("drops the closing address when the correction is long", () => {
    const long = Array.from({ length: 19 }, (_, i) => `word${i}`).join(" ") + ".";
    const line = composeIntervention(setup, long);
    expect(wordCount(line)).toBeLessThanOrEqual(25);
    expect(line.startsWith("Rahul, a quick flag.")).toBe(true);
    expect(line).not.toContain("please note");
  });

  it("uses every correction in the pack within the word budget", () => {
    for (const p of pack.prohibited) {
      const line = composeIntervention(setup, p.correction);
      expect(wordCount(line), p.id).toBeLessThanOrEqual(25);
    }
  });

  it("exposes the eight second acknowledgement window", () => {
    expect(ACK_WINDOW_MS).toBe(8000);
  });
});

describe("composeNudge", () => {
  it("returns null when nothing is missing", () => {
    const board = emptyBoard(pack);
    const allMet = {
      ...board,
      checkpoints: board.checkpoints.map((c) => ({ ...c, status: "met" as const })),
    };
    expect(composeNudge(pack, allMet)).toBeNull();
  });

  it("reads one missing disclosure as a single sentence using the spoken label", () => {
    const board = emptyBoard(pack);
    const oneMissing = {
      ...board,
      checkpoints: board.checkpoints.map((c) => ({
        ...c,
        status: c.id === "free_look_30" ? ("pending" as const) : ("met" as const),
      })),
    };
    const line = composeNudge(pack, oneMissing);
    expect(line).toBe("Before we finish, the thirty day free look period has not been mentioned.");
  });

  it("joins two or three and summarises more, staying under 25 words", () => {
    const board = emptyBoard(pack);
    const two = {
      ...board,
      checkpoints: board.checkpoints.map((c) => ({
        ...c,
        status: ["free_look_30", "surrender_value"].includes(c.id)
          ? ("pending" as const)
          : ("met" as const),
      })),
    };
    expect(composeNudge(pack, two)).toBe(
      "Before we finish, the surrender value and the thirty day free look period have not been mentioned.",
    );
    const all = composeNudge(pack, board)!;
    expect(wordCount(all)).toBeLessThanOrEqual(25);
    expect(all).toMatch(/and \d+ more/);
    expect(all).not.toMatch(/[!*_#`]/);
  });
});
