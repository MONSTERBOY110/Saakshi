import type { RoomController } from "./controller";

// Tool result timing, settled from the Voice Agent client-side-tools page on 2026-09-06:
// "Send tool.result when reply.done is the latest event you've received." Not earlier, because the
// agent is still mid transition phrase, and not later, because a new turn has started. Our gotchas
// file said to send immediately; the docs win (CLAUDE.md rule 4).
//
// Hold-mode tools are the documented exception: the agent stays silent, no reply is in flight, and
// the tool result is what fires the next reply. Waiting for a reply.done that will never come would
// deadlock the room, so those results go out at once through sendNow.

export type PendingToolResult = { callId: string; result: unknown; isError?: boolean };
type TurnEvent = "reply.started" | "input.speech.started" | "reply.done";

export class ToolResultQueue {
  private lastEvent: TurnEvent | null = null;
  private pending: PendingToolResult[] = [];

  /** A turn started, so anything queued waits for it to end. */
  noteTurnStarted(event: "reply.started" | "input.speech.started"): void {
    this.lastEvent = event;
  }

  /** A reply finished. An interrupted reply means the agent moved on, so stale results are dropped. */
  noteReplyDone(c: RoomController, interrupted: boolean): void {
    this.lastEvent = "reply.done";
    if (interrupted) {
      if (this.pending.length > 0) {
        c.log("client", "tool.result.dropped", {
          count: this.pending.length,
          reason: "interrupted",
        });
      }
      this.pending = [];
      return;
    }
    this.flush(c);
  }

  /** Queue an interactive tool's result and send it if the agent is already idle. */
  queue(c: RoomController, item: PendingToolResult): void {
    this.pending.push(item);
    this.flush(c);
  }

  /** Hold-mode only: the result is what wakes the agent, so it cannot wait for a reply. */
  sendNow(c: RoomController, item: PendingToolResult): void {
    c.log("client", "tool.result", { call_id: item.callId, hold: true, is_error: item.isError });
    c.mouth?.toolResult(item.callId, item.result, item.isError);
  }

  reset(): void {
    this.lastEvent = null;
    this.pending = [];
  }

  private flush(c: RoomController): void {
    if (this.lastEvent !== "reply.done" || this.pending.length === 0) return;
    const going = this.pending;
    this.pending = [];
    for (const item of going) {
      c.log("client", "tool.result", { call_id: item.callId, is_error: item.isError });
      c.mouth?.toolResult(item.callId, item.result, item.isError);
    }
  }
}
