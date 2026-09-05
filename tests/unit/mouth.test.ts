import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildInitialSession } from "@/lib/aai/agent-config";
import { Mouth, type MouthEvent } from "@/lib/aai/mouth";
import { FakeWebSocket } from "../mocks/fake-websocket";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "agent", name), "utf8"));
const audio = (data = "AQD//w==") => ({ ...fixture("reply-audio.json"), data });

const session = buildInitialSession({
  systemPrompt: "You are Saakshi.",
  greeting: "I am Saakshi. Please say your name.",
  keyterms: ["Rahul"],
  languageCodes: ["en", "hi"],
}).session;

function make() {
  const events: MouthEvent[] = [];
  const mintToken = vi.fn(async () => "agent-tok");
  let now = 5_000;
  const mouth = new Mouth({
    mintToken,
    session,
    onEvent: (e) => events.push(e),
    WebSocketCtor: FakeWebSocket as never,
    now: () => now,
    readyTimeoutMs: 1000,
  });
  return { mouth, events, mintToken, tick: (ms: number) => (now += ms) };
}

async function openMouth() {
  const m = make();
  const p = m.mouth.connect();
  await Promise.resolve();
  await Promise.resolve();
  const ws = FakeWebSocket.latest();
  ws.serverOpen();
  ws.serverMessage(fixture("session-updated.json"));
  ws.serverMessage(fixture("session-ready.json"));
  await p;
  return { ...m, ws };
}

beforeEach(() => FakeWebSocket.reset());

describe("Mouth connect", () => {
  it("opens with the token, sends session.update first and resolves on session.ready", async () => {
    const { mouth, events, ws } = await openMouth();
    expect(ws.url).toBe("wss://agents.assemblyai.com/v1/ws?token=agent-tok");
    expect(ws.sentJson()[0]).toEqual({ type: "session.update", session });
    expect(mouth.ready).toBe(true);
    expect(mouth.sessionId).toBe(
      (fixture("session-ready.json") as { session_id: string }).session_id,
    );
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["status", "updated", "ready"]),
    );
  });

  it("drops audio before ready and sends base64 input.audio after", async () => {
    const m = make();
    const p = m.mouth.connect();
    await Promise.resolve();
    await Promise.resolve();
    const ws = FakeWebSocket.latest();
    ws.serverOpen();
    expect(m.mouth.sendAudio(new Int16Array([1, -1]))).toBe(false);
    ws.serverMessage(fixture("session-ready.json"));
    await p;
    expect(m.mouth.sendAudio(new Int16Array([1, -1]))).toBe(true);
    expect(ws.sentJson().at(-1)).toEqual({ type: "input.audio", audio: "AQD//w==" });
  });
});

describe("Mouth events from recorded fixtures", () => {
  it("maps reply lifecycle events and marks the first audio chunk", async () => {
    const { events, ws } = await openMouth();
    events.length = 0;
    ws.serverMessage(fixture("reply-started.json"));
    ws.serverMessage(audio());
    ws.serverMessage(audio());
    ws.serverMessage(fixture("transcript-agent-delta.json"));
    ws.serverMessage(fixture("transcript-agent.json"));
    ws.serverMessage(fixture("reply-done-completed.json"));
    ws.serverMessage(fixture("input-speech-started.json"));
    ws.serverMessage(fixture("transcript-user-delta.json"));
    ws.serverMessage(fixture("transcript-user.json"));
    ws.serverMessage(fixture("reply-done-interrupted.json"));
    ws.serverMessage(fixture("session-ended.json"));
    expect(events.map((e) => e.type)).toEqual([
      "reply_started",
      "reply_audio",
      "reply_audio",
      "agent_delta",
      "agent_final",
      "reply_done",
      "speech_started",
      "user_delta",
      "user_final",
      "reply_done",
      "ended",
    ]);
    const chunks = events.filter((e) => e.type === "reply_audio") as Array<{ firstChunk: boolean }>;
    expect(chunks.map((c) => c.firstChunk)).toEqual([true, false]);
    const dones = events.filter((e) => e.type === "reply_done") as Array<{ status: string }>;
    expect(dones.map((d) => d.status)).toEqual(["completed", "interrupted"]);
  });

  it("emits latency from reply.create to the first audio chunk", async () => {
    const { mouth, events, ws, tick } = await openMouth();
    expect(mouth.replyCreate("Say exactly this: hello.")).toBe(true);
    expect(ws.sentJson().at(-1)).toEqual({
      type: "reply.create",
      instructions: "Say exactly this: hello.",
    });
    tick(254);
    ws.serverMessage(audio());
    ws.serverMessage(audio());
    const latencies = events.filter((e) => e.type === "latency") as Array<{ ms: number }>;
    expect(latencies.map((l) => l.ms)).toEqual([254]);
  });

  it("sends session updates, tool results as JSON strings, and maps tool calls", async () => {
    const { mouth, events, ws } = await openMouth();
    expect(mouth.updateSession({ system_prompt: "New prompt." })).toBe(true);
    expect(mouth.toolResult("c_1", { ok: true, remaining: 2 })).toBe(true);
    expect(ws.sentJson().slice(-2)).toEqual([
      { type: "session.update", session: { system_prompt: "New prompt." } },
      { type: "tool.result", call_id: "c_1", result: '{"ok":true,"remaining":2}' },
    ]);
    ws.serverMessage({
      type: "tool.call",
      call_id: "c_2",
      name: "record_answer",
      arguments: { question_id: "q1" },
    });
    const call = events.find((e) => e.type === "tool_call") as {
      callId: string;
      name: string;
      args: Record<string, unknown>;
    };
    expect(call).toMatchObject({
      callId: "c_2",
      name: "record_answer",
      args: { question_id: "q1" },
    });
  });

  it("surfaces session.error and unparsed payloads", async () => {
    const { events, ws } = await openMouth();
    ws.serverMessage({ type: "session.error", code: "invalid_config", message: "bad" });
    ws.serverMessage({ type: "session.ended", audio_duration_seconds: "oops" });
    const err = events.find((e) => e.type === "error") as { code: string };
    expect(err.code).toBe("invalid_config");
    expect(events.some((e) => e.type === "unparsed")).toBe(true);
  });
});

describe("Mouth lifecycle", () => {
  it("end sends session.end and resolves on session.ended, marking the close intentional", async () => {
    const { mouth, events, ws } = await openMouth();
    const done = mouth.end(1000);
    expect(ws.sentJson().at(-1)).toEqual({ type: "session.end" });
    ws.serverMessage(fixture("session-ended.json"));
    ws.serverClose(1000);
    await done;
    expect(mouth.ready).toBe(false);
    const closed = events.find((e) => e.type === "closed") as { intentional: boolean };
    expect(closed.intentional).toBe(true);
  });

  it("rejects connect when session.ready does not arrive in time", async () => {
    vi.useFakeTimers();
    try {
      const m = make();
      const p = m.mouth.connect();
      await Promise.resolve();
      await Promise.resolve();
      FakeWebSocket.latest().serverOpen();
      const assertion = expect(p).rejects.toThrow(/session.ready/);
      await vi.advanceTimersByTimeAsync(1100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
