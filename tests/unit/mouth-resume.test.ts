import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETUP } from "@/lib/session/keyterms";
import type { Phase } from "@/lib/session/machine";
import { onMouthClosed } from "@/lib/session/mouth-resume";

// A Voice Agent socket can drop mid teach-back. The room has 30 s to reattach with session.resume;
// whatever happens, the silence is written into the certificate as a gap.

const QUESTIONS = [
  {
    id: "q1",
    topic: "lock_in",
    question: "How long is your money locked in?",
    expectedPoints: [],
    source: "pack" as const,
  },
  {
    id: "q2",
    topic: "charges",
    question: "What charges come out of your premium?",
    expectedPoints: [],
    source: "pack" as const,
  },
];

function makeController(phase: Phase = "TEACHBACK", opts: { resumeFails?: number } = {}) {
  const resumeCalls: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const replies: string[] = [];
  const logs: string[] = [];
  let failures = opts.resumeFails ?? 0;
  const state = {
    phase,
    setup: DEFAULT_SETUP,
    gaps: [] as Array<{ fromMs: number; toMs: number; code: number }>,
    status: { mouthSessionId: "sess_1" } as Record<string, unknown>,
    teachback: {
      status: "asking",
      source: "pack",
      questions: QUESTIONS,
      answers: [{ questionId: "q1" }],
      reexplained: [],
      advisorInterjections: 0,
      finishOffered: false,
    } as Record<string, unknown>,
  };
  const c = {
    t0: 1_000,
    state,
    mouth: {
      async resume(sessionId: string) {
        resumeCalls.push(sessionId);
        if (failures > 0) {
          failures -= 1;
          throw new Error("session.resume not confirmed");
        }
      },
      updateSession(session: Record<string, unknown>) {
        updates.push(session);
        return true;
      },
      replyCreate(instructions: string) {
        replies.push(instructions);
        return true;
      },
    },
    set(patch: Record<string, unknown> | ((s: typeof state) => Record<string, unknown>)) {
      Object.assign(state, typeof patch === "function" ? patch(state) : patch);
    },
    log(_source: string, type: string) {
      logs.push(type);
    },
  };
  return {
    c: c as never as Parameters<typeof onMouthClosed>[0],
    state,
    resumeCalls,
    updates,
    replies,
    logs,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockReturnValue(10_000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const dropped = { code: 1006, reason: "abnormal", intentional: false };

describe("onMouthClosed", () => {
  it("does nothing when the room closed the socket on purpose", async () => {
    const h = makeController();
    onMouthClosed(h.c, { ...dropped, intentional: true });
    await vi.runAllTimersAsync();
    expect(h.resumeCalls).toHaveLength(0);
    expect(h.state.gaps).toHaveLength(0);
  });

  it("does nothing once the session has finished", async () => {
    const h = makeController("DONE");
    onMouthClosed(h.c, dropped);
    await vi.runAllTimersAsync();
    expect(h.resumeCalls).toHaveLength(0);
  });

  it("does nothing without a session id to resume", async () => {
    const h = makeController();
    h.state.status = {};
    onMouthClosed(h.c, dropped);
    await vi.runAllTimersAsync();
    expect(h.resumeCalls).toHaveLength(0);
  });

  it("resumes the same session and records the silence as a gap", async () => {
    const h = makeController();
    onMouthClosed(h.c, dropped);
    vi.mocked(performance.now).mockReturnValue(12_500);
    await vi.runAllTimersAsync();

    expect(h.resumeCalls).toEqual(["sess_1"]);
    // Gaps are milliseconds since the session started (t0 = 1000).
    expect(h.state.gaps).toEqual([{ fromMs: 9000, toMs: 11500, code: 1006 }]);
    expect(h.logs).toContain("mouth.resumed");
  });

  it("puts the teach-back back together and asks the pending question again", async () => {
    const h = makeController();
    onMouthClosed(h.c, dropped);
    await vi.runAllTimersAsync();

    const update = h.updates[0] as { tools: Array<{ name: string }>; system_prompt: string };
    expect(update.tools.map((t) => t.name)).toEqual(["record_answer", "reexplain"]);
    expect(update.system_prompt).toContain("What charges come out of your premium?");
    // One answer is already recorded, so the room resumes at question two.
    expect(h.replies[0]).toContain("What charges come out of your premium?");
    expect(h.replies[0]).toContain("connection dropped");
  });

  it("retries and succeeds on a later attempt", async () => {
    const h = makeController("TEACHBACK", { resumeFails: 2 });
    onMouthClosed(h.c, dropped);
    await vi.runAllTimersAsync();
    expect(h.resumeCalls).toHaveLength(3);
    expect(h.logs).toContain("mouth.resumed");
    expect(h.state.gaps).toHaveLength(1);
  });

  it("gives up after the resume window and still records the gap", async () => {
    const h = makeController("TEACHBACK", { resumeFails: 99 });
    onMouthClosed(h.c, dropped);
    await vi.runAllTimersAsync();
    expect(h.resumeCalls).toHaveLength(4);
    expect(h.logs).toContain("mouth.resume.gave_up");
    expect(h.state.gaps).toHaveLength(1);
    expect(String((h.state.status as { mouthError: string }).mouthError)).toContain("1006");
  });

  it("stops trying when the room has moved on", async () => {
    const h = makeController("TEACHBACK", { resumeFails: 99 });
    onMouthClosed(h.c, dropped);
    h.state.phase = "DONE";
    await vi.runAllTimersAsync();
    expect(h.logs).toContain("mouth.resume.abandoned");
    expect(h.state.gaps).toHaveLength(0);
  });
});
