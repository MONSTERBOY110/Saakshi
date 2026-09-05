import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ears, type EarsEvent } from "@/lib/aai/ears";
import { FakeWebSocket } from "../mocks/fake-websocket";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "stt", name), "utf8"));

function make(overrides: Partial<ConstructorParameters<typeof Ears>[0]> = {}) {
  const events: EarsEvent[] = [];
  const mintToken = vi.fn(async () => `tok-${mintToken.mock.calls.length}`);
  let now = 1_000;
  const ears = new Ears({
    mintToken,
    config: {
      sampleRate: 24000,
      keyterms: ["Rahul", "Sharma"],
      languageCodes: ["en", "hi"],
      prompt: "Bank.",
    },
    onEvent: (e) => events.push(e),
    WebSocketCtor: FakeWebSocket as never,
    now: () => now,
    ...overrides,
  });
  return { ears, events, mintToken, tick: (ms: number) => (now += ms) };
}

beforeEach(() => FakeWebSocket.reset());

describe("Ears connect and send", () => {
  it("mints a token, opens the streaming URL as binary and reports status", async () => {
    const { ears, events, mintToken } = make();
    const connecting = ears.connect();
    expect(mintToken).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    const ws = FakeWebSocket.latest();
    expect(ws.url.startsWith("wss://streaming.assemblyai.com/v3/ws?")).toBe(true);
    expect(new URL(ws.url).searchParams.get("token")).toBe("tok-1");
    expect(new URL(ws.url).searchParams.get("format_turns")).toBe("true");
    expect(ws.binaryType).toBe("arraybuffer");
    expect(ears.sendAudio(new Int16Array(1200))).toBe(false);
    ws.serverOpen();
    await connecting;
    expect(ears.status).toBe("open");
    expect(
      events.filter((e) => e.type === "status").map((e) => (e as { status: string }).status),
    ).toEqual(["connecting", "open"]);
  });

  it("sends 50 ms frames as raw binary and control messages as JSON", async () => {
    const { ears } = make();
    const p = ears.connect();
    await Promise.resolve();
    await Promise.resolve();
    const ws = FakeWebSocket.latest();
    ws.serverOpen();
    await p;
    expect(ears.sendAudio(new Int16Array(1200))).toBe(true);
    expect(ws.sentBinary()[0]?.byteLength).toBe(2400);
    expect(
      ears.updateConfiguration({
        keyterms_prompt: ["NAV"],
        agent_context: "Saakshi asked for a name.",
      }),
    ).toBe(true);
    expect(ears.forceEndpoint()).toBe(true);
    expect(ws.sentJson()).toEqual([
      {
        type: "UpdateConfiguration",
        keyterms_prompt: ["NAV"],
        agent_context: "Saakshi asked for a name.",
      },
      { type: "ForceEndpoint" },
    ]);
  });
});

describe("Ears events from recorded fixtures", () => {
  async function openEars() {
    const m = make();
    const p = m.ears.connect();
    await Promise.resolve();
    await Promise.resolve();
    const ws = FakeWebSocket.latest();
    ws.serverOpen();
    await p;
    return { ...m, ws };
  }

  it("maps Begin, Turn, Heartbeat, SpeakerRevision and Termination", async () => {
    const { ears, events, ws } = await openEars();
    ws.serverMessage(fixture("begin.json"));
    ws.serverMessage(fixture("turn-partial.json"));
    ws.serverMessage(fixture("turn-final-a.json"));
    ws.serverMessage(fixture("heartbeat.json"));
    ws.serverMessage(fixture("speaker-revision.json"));
    ws.serverMessage(fixture("termination.json"));
    const types = events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(["begin", "turn", "heartbeat", "speaker_revision", "termination"]),
    );
    expect(ears.sessionId).toBe((fixture("begin.json") as { id: string }).id);
    const turns = events.filter((e) => e.type === "turn");
    expect(turns).toHaveLength(2);
  });

  it("reports unparsed and unknown payloads without throwing", async () => {
    const { events, ws } = await openEars();
    ws.serverRaw("not json");
    ws.serverMessage({ type: "BrandNew", x: 1 });
    ws.serverMessage({ type: "Turn", turn_order: "bad" });
    expect(events.filter((e) => e.type === "unparsed")).toHaveLength(2);
    expect(events.filter((e) => e.type === "unknown")).toHaveLength(1);
  });
});

describe("Ears lifecycle", () => {
  it("terminate sends Terminate, resolves on Termination and does not reconnect", async () => {
    const { ears, events, mintToken } = make();
    const p = ears.connect();
    await Promise.resolve();
    await Promise.resolve();
    const ws = FakeWebSocket.latest();
    ws.serverOpen();
    await p;
    const done = ears.terminate(1000);
    expect(ws.sentJson()).toEqual([{ type: "Terminate" }]);
    ws.serverMessage(fixture("termination.json"));
    ws.serverClose(1000);
    await done;
    expect(mintToken).toHaveBeenCalledTimes(1);
    const closed = events.find((e) => e.type === "closed") as { intentional: boolean } | undefined;
    expect(closed?.intentional).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("reconnects after an unexpected close with a gap and a turn-order offset", async () => {
    const { ears, events, mintToken, tick } = make();
    const p = ears.connect();
    await Promise.resolve();
    await Promise.resolve();
    const ws1 = FakeWebSocket.latest();
    ws1.serverOpen();
    await p;
    ws1.serverMessage({ type: "Begin", id: "s1", expires_at: 1 });
    ws1.serverMessage({ ...fixture("turn-final-a.json"), turn_order: 3 });
    tick(500);
    ws1.serverClose(1006, "network");
    // Token mint and reopen happen asynchronously.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(mintToken).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const ws2 = FakeWebSocket.latest();
    expect(new URL(ws2.url).searchParams.get("token")).toBe("tok-2");
    ws2.serverOpen();
    tick(1200);
    ws2.serverMessage({ type: "Begin", id: "s2", expires_at: 2 });
    const gap = events.find((e) => e.type === "gap") as {
      fromMs: number;
      toMs: number;
      code: number;
    };
    expect(gap).toMatchObject({ code: 1006 });
    expect(gap.toMs - gap.fromMs).toBe(1200);
    const begins = events.filter((e) => e.type === "begin") as Array<{
      sessionId: string;
      reconnect: boolean;
    }>;
    expect(begins.map((b) => [b.sessionId, b.reconnect])).toEqual([
      ["s1", false],
      ["s2", true],
    ]);
    ws2.serverMessage({ ...fixture("turn-final-b.json"), turn_order: 0 });
    ws2.serverMessage({
      type: "SpeakerRevision",
      revisions: [{ turn_order: 0, speaker_label: "A", words: [] }],
    });
    const turns = events.filter((e) => e.type === "turn") as Array<{
      turn: { turn_order: number };
    }>;
    expect(turns.map((t) => t.turn.turn_order)).toEqual([3, 4]);
    const rev = events.find((e) => e.type === "speaker_revision") as {
      revision: { revisions: Array<{ turn_order: number }> };
    };
    expect(rev.revision.revisions[0]?.turn_order).toBe(4);
    expect(ears.sessionId).toBe("s2");
  });

  it("does not reconnect when disabled", async () => {
    const { ears, events, mintToken } = make({ reconnect: false });
    const p = ears.connect();
    await Promise.resolve();
    await Promise.resolve();
    const ws = FakeWebSocket.latest();
    ws.serverOpen();
    await p;
    ws.serverClose(1006);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(mintToken).toHaveBeenCalledTimes(1);
    const closed = events.find((e) => e.type === "closed") as { intentional: boolean };
    expect(closed.intentional).toBe(false);
  });
});
