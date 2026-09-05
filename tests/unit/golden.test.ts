import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Begin, SpeakerRevision, Turn } from "@/lib/aai/types";
import { getPack } from "@/lib/rules/load";
import { boardSummary, rebuildBoard } from "@/lib/session/board";
import {
  initialRoles,
  observeFinalTurn,
  roleOfLabel,
  rolesBound,
  type RolesState,
} from "@/lib/session/roles";
import {
  applyRevision,
  applyTurn,
  emptyTranscript,
  finalTurns,
  reassignRoles,
} from "@/lib/session/transcript";

// The whole Phase 1 pipeline over real Streaming STT payloads recorded from the two-voice WAV:
// calibration by name, transcript, rules, board, then the end-of-session speaker revision.
type Golden = { begin: Begin; turns: Turn[]; speaker_revision: SpeakerRevision | null };
const golden = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "fixtures", "golden-turns.json"), "utf8"),
) as Golden;
const pack = getPack("insurance-ulip-in");
const names = { advisor: "Rahul", customer: "Mrs. Sharma" };

function run() {
  let roles: RolesState = initialRoles();
  let transcript = emptyTranscript();
  const roleOf = (label: string | undefined) => roleOfLabel(roles, label);
  for (const turn of golden.turns) {
    const r = applyTurn(transcript, turn, roleOf);
    transcript = r.state;
    if (r.finalized && !rolesBound(roles)) {
      const before = roles;
      roles = observeFinalTurn(
        roles,
        { label: r.finalized.speakerLabel, text: r.finalized.text },
        names,
      ).state;
      if (roles !== before) transcript = reassignRoles(transcript, roleOf);
    }
  }
  return { roles, transcript, roleOf };
}

describe("golden recording through the Phase 1 pipeline", () => {
  it("binds the customer and advisor labels by name regardless of who spoke first", () => {
    const { roles } = run();
    expect(rolesBound(roles)).toBe(true);
    expect(roles.customer).toBe("A");
    expect(roles.advisor).toBe("B");
  });

  it("ticks all eight checkpoints and flags the two planted violations on the advisor turn", () => {
    const { transcript } = run();
    const board = rebuildBoard(pack, finalTurns(transcript));
    expect(boardSummary(board)).toMatchObject({ met: 8, total: 8 });
    const keys = board.violations.map((v) => v.key).sort();
    expect(keys.filter((k) => k.startsWith("guaranteed_returns")).length).toBeGreaterThanOrEqual(1);
    expect(keys.filter((k) => k.startsWith("withdraw_anytime")).length).toBeGreaterThanOrEqual(1);
    expect(keys.every((k) => /^(guaranteed_returns|withdraw_anytime)@/.test(k))).toBe(true);
    for (const v of board.violations) expect(v.evidence.role).toBe("advisor");
  });

  it("survives the end-of-session speaker revision", () => {
    const { transcript, roleOf } = run();
    expect(golden.speaker_revision).not.toBeNull();
    const revised = applyRevision(transcript, golden.speaker_revision!, roleOf);
    expect(revised.changed.length).toBeGreaterThan(0);
    const board = rebuildBoard(pack, finalTurns(revised.state));
    expect(boardSummary(board).met).toBe(8);
  });

  it("attributes at least 90 percent of labelled final turns to a role", () => {
    const { transcript } = run();
    const finals = finalTurns(transcript).filter((t) => !t.pending);
    const withRole = finals.filter((t) => t.role !== undefined);
    expect(withRole.length / finals.length).toBeGreaterThanOrEqual(0.9);
  });
});
