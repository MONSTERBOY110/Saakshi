import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentServerEventSchema,
  parseAgentEvent,
  parseSttMessage,
  SttServerMessageSchema,
  TurnSchema,
} from "@/lib/aai/types";

// Every recorded payload in tests/fixtures must validate against the strict schema for its type.
// Fixtures come from scripts/split-fixtures.mjs over a live session; audio is already stripped.
const root = join(process.cwd(), "tests", "fixtures");

function load(dir: "stt" | "agent"): Array<{ name: string; json: Record<string, unknown> }> {
  return readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".json"))
    .map((name) => ({
      name,
      json: JSON.parse(readFileSync(join(root, dir, name), "utf8")) as Record<string, unknown>,
    }));
}

describe("recorded STT fixtures", () => {
  const files = load("stt");

  it("has at least the session lifecycle messages", () => {
    const names = files.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining(["begin.json", "heartbeat.json", "termination.json"]),
    );
  });

  it.each(files.map((f) => [f.name, f.json] as const))(
    "%s parses as a known message",
    (_name, json) => {
      const result = parseSttMessage(JSON.stringify(json));
      expect(result.type).not.toBe("unparsed");
      expect(result.type).not.toBe("unknown");
      expect(SttServerMessageSchema.safeParse(json).success).toBe(true);
    },
  );

  it.each(
    files.filter((f) => f.name.startsWith("turn-final-")).map((f) => [f.name, f.json] as const),
  )("%s is a finalized turn with a speaker label", (name, json) => {
    const turn = TurnSchema.parse(json);
    expect(turn.end_of_turn).toBe(true);
    if (!name.includes("unformatted")) expect(turn.turn_is_formatted).toBe(true);
    expect(turn.speaker_label).toBeDefined();
    expect(turn.words.length).toBeGreaterThan(0);
  });
});

describe("recorded Voice Agent fixtures", () => {
  const files = load("agent");
  const inbound = files.filter((f) => !f.name.startsWith("out-"));
  const outbound = files.filter((f) => f.name.startsWith("out-"));

  it("has the session lifecycle events", () => {
    const names = files.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining(["session-ready.json", "reply-audio.json", "session-ended.json"]),
    );
  });

  it.each(inbound.map((f) => [f.name, f.json] as const))(
    "%s parses as a known event",
    (_name, json) => {
      // The recorder replaces audio with data_len/data_head; restore a stub so the schema applies.
      const restored = json.type === "reply.audio" ? { ...json, data: "AA==" } : json;
      const result = parseAgentEvent(JSON.stringify(restored));
      expect(result.type).not.toBe("unparsed");
      expect(result.type).not.toBe("unknown");
      expect(AgentServerEventSchema.safeParse(restored).success).toBe(true);
    },
  );

  it.each(outbound.map((f) => [f.name, f.json] as const))(
    "%s is a client message with a type",
    (_name, json) => {
      expect(typeof json.type).toBe("string");
    },
  );

  it("keeps no audio in any fixture", () => {
    for (const f of files) {
      const text = JSON.stringify(f.json);
      expect(text, f.name).not.toMatch(/"data":\s*"[A-Za-z0-9+/=]{64,}"/);
      expect(text, f.name).not.toMatch(/"audio":\s*"[A-Za-z0-9+/=]{64,}"/);
    }
  });
});
