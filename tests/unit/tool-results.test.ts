import { describe, expect, it } from "vitest";
import { ToolResultQueue } from "@/lib/session/tool-results";

// The timing rule under test comes from the Voice Agent client-side-tools page: a tool result goes
// out when reply.done is the latest event, never mid-reply.

function harness() {
  const sent: Array<{ callId: string; result: unknown; isError?: boolean }> = [];
  const logs: string[] = [];
  const c = {
    mouth: {
      toolResult(callId: string, result: unknown, isError?: boolean) {
        sent.push({ callId, result, isError });
        return true;
      },
    },
    log(_source: string, type: string) {
      logs.push(type);
    },
  };
  return { c: c as never as Parameters<ToolResultQueue["queue"]>[0], sent, logs };
}

describe("ToolResultQueue", () => {
  it("holds a result while the agent is still speaking", () => {
    const { c, sent } = harness();
    const q = new ToolResultQueue();
    q.noteTurnStarted("reply.started");
    q.queue(c, { callId: "c1", result: { ok: true } });
    expect(sent).toHaveLength(0);

    q.noteReplyDone(c, false);
    expect(sent.map((s) => s.callId)).toEqual(["c1"]);
  });

  it("sends at once when the agent is already idle", () => {
    const { c, sent } = harness();
    const q = new ToolResultQueue();
    q.noteTurnStarted("reply.started");
    q.noteReplyDone(c, false);
    // The tool finished after the reply ended, which the docs call out explicitly.
    q.queue(c, { callId: "c2", result: { ok: true } });
    expect(sent.map((s) => s.callId)).toEqual(["c2"]);
  });

  it("holds a result while the customer is speaking", () => {
    const { c, sent } = harness();
    const q = new ToolResultQueue();
    q.noteTurnStarted("input.speech.started");
    q.queue(c, { callId: "c3", result: {} });
    expect(sent).toHaveLength(0);
    q.noteReplyDone(c, false);
    expect(sent).toHaveLength(1);
  });

  it("drops a stale result when the reply was interrupted", () => {
    const { c, sent, logs } = harness();
    const q = new ToolResultQueue();
    q.noteTurnStarted("reply.started");
    q.queue(c, { callId: "c4", result: {} });
    q.noteReplyDone(c, true);
    expect(sent).toHaveLength(0);
    expect(logs).toContain("tool.result.dropped");
    // A later reply must not resurrect it.
    q.noteReplyDone(c, false);
    expect(sent).toHaveLength(0);
  });

  it("sends every queued result in order once the turn ends", () => {
    const { c, sent } = harness();
    const q = new ToolResultQueue();
    q.noteTurnStarted("reply.started");
    q.queue(c, { callId: "a", result: {} });
    q.queue(c, { callId: "b", result: {} });
    q.noteReplyDone(c, false);
    expect(sent.map((s) => s.callId)).toEqual(["a", "b"]);
  });

  it("sends a hold-mode result immediately, since no reply is in flight to wait for", () => {
    const { c, sent } = harness();
    const q = new ToolResultQueue();
    q.noteTurnStarted("input.speech.started");
    q.sendNow(c, { callId: "hold1", result: { ok: true } });
    expect(sent.map((s) => s.callId)).toEqual(["hold1"]);
  });

  it("forgets everything on reset so a new session starts clean", () => {
    const { c, sent } = harness();
    const q = new ToolResultQueue();
    q.noteTurnStarted("reply.started");
    q.queue(c, { callId: "old", result: {} });
    q.reset();
    q.noteReplyDone(c, false);
    expect(sent).toHaveLength(0);
  });
});
