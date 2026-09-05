import { describe, expect, it } from "vitest";
import {
  AgentServerEventSchema,
  parseAgentEvent,
  parseSttMessage,
  SpeakerRevisionSchema,
  SttServerMessageSchema,
  TurnSchema,
} from "@/lib/aai/types";

// Hand-written samples follow the field lists verified from the docs on 2026-09-05.
// Task 7 replaces them with recorded fixtures.
const partialTurn = {
  type: "Turn",
  turn_order: 0,
  turn_is_formatted: false,
  end_of_turn: false,
  transcript: "namaste my name",
  utterance: "namaste my name",
  end_of_turn_confidence: 0.12,
  words: [{ text: "namaste", start: 120, end: 560, confidence: 0.91, word_is_final: false }],
};
const finalTurn = {
  ...partialTurn,
  turn_is_formatted: true,
  end_of_turn: true,
  transcript: "Namaste, my name is Rahul.",
  speaker_label: "A",
  language_code: "en",
  language_confidence: 0.94,
  end_of_turn_confidence: 0.88,
  words: [
    { text: "Namaste,", start: 120, end: 560, confidence: 0.91, word_is_final: true, speaker: "A" },
  ],
};

describe("STT schemas", () => {
  it("accepts Begin, partial and final Turn, PENDING, SpeakerRevision, Heartbeat, Termination", () => {
    const messages = [
      { type: "Begin", id: "6f2c", expires_at: 1_757_000_000 },
      partialTurn,
      finalTurn,
      { ...finalTurn, speaker_label: "PENDING" },
      {
        type: "SpeakerRevision",
        revisions: [
          {
            turn_order: 3,
            speaker_label: "B",
            words: [{ text: "hi", speaker: "B", start: 1, end: 2 }],
          },
        ],
      },
      {
        type: "Heartbeat",
        total_audio_received_ms: 1000,
        total_duration_ms: 1010,
        realtime_factor: 1.01,
        max_speech_probability: 0.7,
      },
      { type: "Termination", audio_duration_seconds: 10, session_duration_seconds: 12 },
    ];
    for (const m of messages) {
      const r = SttServerMessageSchema.safeParse(m);
      expect(r.success, `${m.type}: ${r.success ? "" : r.error.message}`).toBe(true);
    }
  });

  it("keeps per-word speaker optional and turn-level speaker_label optional on partials", () => {
    const parsed = TurnSchema.parse(partialTurn);
    expect(parsed.speaker_label).toBeUndefined();
    expect(parsed.words[0]?.speaker).toBeUndefined();
  });

  it("rejects a Turn missing required fields", () => {
    expect(TurnSchema.safeParse({ type: "Turn", turn_order: 1 }).success).toBe(false);
  });

  it("passes unknown message types through as { type }", () => {
    const parsed = SttServerMessageSchema.parse({ type: "SomethingNew", foo: 1 });
    expect(parsed.type).toBe("SomethingNew");
  });

  it("allows a null speaker_label in a revision", () => {
    const r = SpeakerRevisionSchema.safeParse({
      type: "SpeakerRevision",
      revisions: [{ turn_order: 1, speaker_label: null, words: [] }],
    });
    expect(r.success).toBe(true);
  });

  it("parseSttMessage wraps bad JSON and schema failures as unparsed", () => {
    expect(parseSttMessage("not json")).toMatchObject({ type: "unparsed", raw: "not json" });
    expect(parseSttMessage(JSON.stringify({ type: "Turn", turn_order: "x" }))).toMatchObject({
      type: "unparsed",
    });
    expect(parseSttMessage(JSON.stringify(finalTurn))).toMatchObject({
      type: "Turn",
      speaker_label: "A",
    });
  });
});

describe("Voice Agent schemas", () => {
  it("accepts the events the spike page handles", () => {
    const events = [
      {
        type: "session.ready",
        session_id: "sess_1",
        expires_at: 1_757_000_000,
        resume_token: "r1",
        config: {},
      },
      { type: "session.updated", config: {} },
      { type: "session.error", code: "invalid_config", message: "bad", param: "input.format" },
      { type: "input.speech.started" },
      { type: "input.speech.stopped" },
      { type: "transcript.user.delta", item_id: "i1", text: "my name" },
      { type: "transcript.user", item_id: "i1", text: "my name is Rahul" },
      { type: "reply.started", reply_id: "r1", item_id: "i2" },
      { type: "reply.audio", data: "AQD//w==" },
      {
        type: "transcript.agent.delta",
        reply_id: "r1",
        item_id: "i2",
        delta: "I am",
        start_ms: 0,
        end_ms: 400,
      },
      {
        type: "transcript.agent.delta",
        reply_id: "r1",
        item_id: "i2",
        delta: "Saakshi",
        start_ms: null,
        end_ms: null,
      },
      {
        type: "transcript.agent",
        reply_id: "r1",
        item_id: "i2",
        text: "I am Saakshi.",
        interrupted: false,
      },
      { type: "reply.done", reply_id: "r1", status: "completed" },
      { type: "reply.done", reply_id: "r1", status: "interrupted" },
      { type: "tool.call", call_id: "c1", name: "record_answer", arguments: { question_id: "q1" } },
      { type: "session.ended", session_duration_seconds: 42.7, audio_duration_seconds: 38.2 },
    ];
    for (const e of events) {
      const r = AgentServerEventSchema.safeParse(e);
      expect(r.success, `${e.type}: ${r.success ? "" : r.error.message}`).toBe(true);
    }
  });

  it("rejects reply.done with an unknown status", () => {
    const r = AgentServerEventSchema.safeParse({
      type: "reply.done",
      reply_id: "r",
      status: "weird",
    });
    expect(r.success).toBe(false);
  });

  it("passes unknown event types through", () => {
    expect(AgentServerEventSchema.parse({ type: "future.event" }).type).toBe("future.event");
  });

  it("parseAgentEvent wraps failures as unparsed", () => {
    expect(parseAgentEvent("{")).toMatchObject({ type: "unparsed" });
    expect(parseAgentEvent(JSON.stringify({ type: "reply.audio", data: "AA==" }))).toMatchObject({
      type: "reply.audio",
    });
  });
});
