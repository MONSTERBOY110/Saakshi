import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SpeakerRevision, Turn } from "@/lib/aai/types";
import {
  applyRevision,
  applyTurn,
  emptyTranscript,
  formatClock,
  previousFinal,
  reassignRoles,
} from "@/lib/session/transcript";

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "stt", name), "utf8")) as T;

const roles = (label: string | undefined) =>
  label === "A" ? "advisor" : label === "B" ? "customer" : undefined;

const partial = (order: number, text: string): Turn => ({
  type: "Turn",
  turn_order: order,
  turn_is_formatted: false,
  end_of_turn: false,
  transcript: text,
  end_of_turn_confidence: 0.1,
  words: text.split(" ").map((w, i) => ({
    text: w,
    start: order * 10_000 + i * 300,
    end: order * 10_000 + i * 300 + 250,
    confidence: 0.9,
    word_is_final: false,
  })),
});

const final = (order: number, text: string, label: string, opts: Partial<Turn> = {}): Turn => ({
  ...partial(order, text),
  turn_is_formatted: true,
  end_of_turn: true,
  speaker_label: label,
  language_code: "en",
  language_confidence: 0.9,
  words: partial(order, text).words.map((w) => ({ ...w, word_is_final: true, speaker: label })),
  ...opts,
});

describe("applyTurn", () => {
  it("renders partials live and locks the final with role, language and timing", () => {
    let s = emptyTranscript();
    s = applyTurn(s, partial(0, "good morning"), roles).state;
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({ order: 0, text: "good morning", final: false });

    const r = applyTurn(s, final(0, "Good morning, Mrs. Sharma.", "A"), roles);
    expect(r.finalized?.order).toBe(0);
    expect(r.state.turns[0]).toMatchObject({
      final: true,
      formatted: true,
      speakerLabel: "A",
      role: "advisor",
      language: "en",
      startMs: 0,
      endMs: 1150,
    });
  });

  it("ignores a late partial for a turn that is already final", () => {
    let s = emptyTranscript();
    s = applyTurn(s, final(0, "Final text.", "A"), roles).state;
    s = applyTurn(s, partial(0, "late partial"), roles).state;
    expect(s.turns[0]?.text).toBe("Final text.");
  });

  it("emits finalized once and updated when the formatted version follows", () => {
    let s = emptyTranscript();
    const unformatted = final(1, "returns are guaranteed twelve percent", "A", {
      turn_is_formatted: false,
    });
    const first = applyTurn(s, unformatted, roles);
    expect(first.finalized?.text).toBe("returns are guaranteed twelve percent");
    s = first.state;
    const second = applyTurn(s, final(1, "Returns are guaranteed, twelve percent.", "A"), roles);
    expect(second.finalized).toBeUndefined();
    expect(second.updated?.text).toBe("Returns are guaranteed, twelve percent.");
    expect(second.state.turns).toHaveLength(1);
  });

  it("keeps PENDING turns unassigned and tags mixed-script Hindi", () => {
    let s = emptyTranscript();
    s = applyTurn(s, final(2, "Namaste.", "PENDING"), roles).state;
    expect(s.turns[0]).toMatchObject({ pending: true, role: undefined });
    s = applyTurn(
      s,
      final(3, "पांच साल, five years, uske baad.", "B", { language_code: "hi" }),
      roles,
    ).state;
    expect(s.turns[1]).toMatchObject({ role: "customer", language: "hi+en" });
  });

  it("orders turns by turn_order and finds the previous final", () => {
    let s = emptyTranscript();
    s = applyTurn(s, final(5, "five", "A"), roles).state;
    s = applyTurn(s, final(3, "three", "B"), roles).state;
    s = applyTurn(s, partial(6, "six"), roles).state;
    expect(s.turns.map((t) => t.order)).toEqual([3, 5, 6]);
    expect(previousFinal(s, 5)?.order).toBe(3);
    expect(previousFinal(s, 6)?.order).toBe(5);
    expect(previousFinal(s, 3)).toBeUndefined();
  });

  it("accepts the recorded fixtures", () => {
    let s = emptyTranscript();
    for (const name of [
      "turn-partial.json",
      "turn-final-a.json",
      "turn-final-b.json",
      "turn-pending.json",
      "turn-hindi.json",
    ]) {
      s = applyTurn(s, fixture<Turn>(name), roles).state;
    }
    expect(s.turns.filter((t) => t.final).length).toBeGreaterThanOrEqual(3);
    expect(s.turns.every((t) => typeof t.language === "string")).toBe(true);
  });
});

describe("applyRevision and reassignRoles", () => {
  it("relabels revised turns, updates roles and marks them revised", () => {
    let s = emptyTranscript();
    s = applyTurn(s, final(1, "My name is Rahul.", "PENDING"), roles).state;
    s = applyTurn(s, final(2, "Namaste.", "PENDING"), roles).state;
    const revision: SpeakerRevision = {
      type: "SpeakerRevision",
      revisions: [
        {
          turn_order: 1,
          speaker_label: "A",
          words: [{ text: "My", speaker: "A", start: 10000, end: 10250 }],
        },
        { turn_order: 2, speaker_label: "B", words: [] },
        { turn_order: 99, speaker_label: "A", words: [] },
      ],
    };
    const r = applyRevision(s, revision, roles);
    expect(r.changed).toEqual([1, 2]);
    expect(r.state.turns[0]).toMatchObject({
      speakerLabel: "A",
      role: "advisor",
      revised: true,
      pending: false,
    });
    expect(r.state.turns[1]).toMatchObject({ speakerLabel: "B", role: "customer", revised: true });
  });

  it("recomputes every role after a swap", () => {
    let s = emptyTranscript();
    s = applyTurn(s, final(0, "a", "A"), roles).state;
    s = applyTurn(s, final(1, "b", "B"), roles).state;
    const swapped = reassignRoles(s, (l) =>
      l === "A" ? "customer" : l === "B" ? "advisor" : undefined,
    );
    expect(swapped.turns.map((t) => t.role)).toEqual(["customer", "advisor"]);
  });

  it("accepts the recorded SpeakerRevision fixture", () => {
    const rev = fixture<SpeakerRevision>("speaker-revision.json");
    let s = emptyTranscript();
    for (const r of rev.revisions)
      s = applyTurn(s, final(r.turn_order, "x", "PENDING"), roles).state;
    const out = applyRevision(s, rev, roles);
    expect(out.changed.length).toBe(rev.revisions.length);
  });
});

describe("formatClock", () => {
  it("renders mm:ss", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(41_000)).toBe("00:41");
    expect(formatClock(125_400)).toBe("02:05");
  });
});

describe("revision policy for labelled turns", () => {
  it("keeps the live label and role, records the proposal, and does not count it as changed", () => {
    let s = emptyTranscript();
    s = applyTurn(s, final(6, "There is a 5-year lock-in.", "A"), roles).state;
    s = applyTurn(s, final(7, "Namaste.", "PENDING"), roles).state;
    const r = applyRevision(
      s,
      {
        type: "SpeakerRevision",
        revisions: [
          { turn_order: 6, speaker_label: "B", words: [] },
          { turn_order: 7, speaker_label: "B", words: [] },
        ],
      },
      roles,
    );
    expect(r.changed).toEqual([7]);
    expect(r.state.turns[0]).toMatchObject({
      speakerLabel: "A",
      role: "advisor",
      revised: true,
      revisedLabel: "B",
    });
    expect(r.state.turns[1]).toMatchObject({ speakerLabel: "B", role: "customer", pending: false });
  });
});
