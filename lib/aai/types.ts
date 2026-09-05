import { z } from "zod";

// Wire schemas for both AssemblyAI sockets, verified against the docs on 2026-09-05.
// Known message types are validated strictly; unknown types pass through as { type } so a new
// server event never crashes the client. Objects are loose so recorded fixtures keep extra fields.

// ---------------------------------------------------------------- Streaming STT, server → client

export const TurnWordSchema = z.looseObject({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.number(),
  word_is_final: z.boolean(),
  /** "A", "B", "PENDING", or absent (fall back to the turn-level label). */
  speaker: z.string().optional(),
});

export const BeginSchema = z.looseObject({
  type: z.literal("Begin"),
  id: z.string(),
  expires_at: z.number(),
  configuration: z.record(z.string(), z.unknown()).optional(),
});

export const TurnSchema = z.looseObject({
  type: z.literal("Turn"),
  turn_order: z.number().int(),
  turn_is_formatted: z.boolean(),
  end_of_turn: z.boolean(),
  transcript: z.string(),
  utterance: z.string().optional(),
  language_code: z.string().optional(),
  language_confidence: z.number().optional(),
  /** "A", "B", or "PENDING" for turns under about one second. */
  speaker_label: z.string().optional(),
  end_of_turn_confidence: z.number(),
  words: z.array(TurnWordSchema),
});

export const SpeakerRevisionSchema = z.looseObject({
  type: z.literal("SpeakerRevision"),
  revisions: z.array(
    z.looseObject({
      turn_order: z.number().int(),
      speaker_label: z.string().nullable(),
      words: z.array(
        z.looseObject({
          text: z.string(),
          speaker: z.string(),
          start: z.number(),
          end: z.number(),
        }),
      ),
    }),
  ),
});

export const HeartbeatSchema = z.looseObject({
  type: z.literal("Heartbeat"),
  total_audio_received_ms: z.number(),
  total_duration_ms: z.number(),
  realtime_factor: z.number(),
  max_speech_probability: z.number(),
});

export const TerminationSchema = z.looseObject({
  type: z.literal("Termination"),
  audio_duration_seconds: z.number(),
  session_duration_seconds: z.number(),
});

export const SpeechStartedSchema = z.looseObject({
  type: z.literal("SpeechStarted"),
  timestamp: z.number(),
  confidence: z.number(),
});

const KnownSttSchema = z.discriminatedUnion("type", [
  BeginSchema,
  TurnSchema,
  SpeakerRevisionSchema,
  HeartbeatSchema,
  TerminationSchema,
  SpeechStartedSchema,
]);
const KNOWN_STT_TYPES = new Set<string>(KnownSttSchema.options.map((o) => o.shape.type.value));
const UnknownSttSchema = z
  .looseObject({ type: z.string() })
  .refine((m) => !KNOWN_STT_TYPES.has(m.type), "known type failed strict validation");

export const SttServerMessageSchema = z.union([KnownSttSchema, UnknownSttSchema]);

export type Begin = z.infer<typeof BeginSchema>;
export type Turn = z.infer<typeof TurnSchema>;
export type TurnWord = z.infer<typeof TurnWordSchema>;
export type SpeakerRevision = z.infer<typeof SpeakerRevisionSchema>;
export type Heartbeat = z.infer<typeof HeartbeatSchema>;
export type Termination = z.infer<typeof TerminationSchema>;
export type KnownSttMessage = z.infer<typeof KnownSttSchema>;
export type SttServerMessage = z.infer<typeof SttServerMessageSchema>;

// ---------------------------------------------------------------- Streaming STT, client → server

export type SttClientMessage =
  | {
      type: "UpdateConfiguration";
      prompt?: string;
      keyterms_prompt?: string[];
      language_codes?: string[];
      agent_context?: string;
    }
  | { type: "ForceEndpoint" }
  | { type: "Terminate" }
  | { type: "KeepAlive" };

// ---------------------------------------------------------------- Voice Agent, server → client

const idFields = { reply_id: z.string().optional(), item_id: z.string().optional() };

const KnownAgentSchema = z.discriminatedUnion("type", [
  z.looseObject({
    type: z.literal("session.ready"),
    session_id: z.string(),
    expires_at: z.number().optional(),
    resume_token: z.string().optional(),
    config: z.unknown().optional(),
  }),
  z.looseObject({ type: z.literal("session.updated"), config: z.unknown().optional() }),
  z.looseObject({
    type: z.literal("session.error"),
    code: z.string(),
    message: z.string(),
    param: z.string().nullable().optional(),
  }),
  z.looseObject({
    type: z.literal("session.ended"),
    // Observed live on 2026-09-05: audio_duration_seconds arrives as null when no audio was sent.
    session_duration_seconds: z.number().nullable().optional(),
    audio_duration_seconds: z.number().nullable().optional(),
  }),
  z.looseObject({ type: z.literal("input.speech.started") }),
  z.looseObject({ type: z.literal("input.speech.stopped") }),
  z.looseObject({
    type: z.literal("transcript.user.delta"),
    item_id: z.string().optional(),
    text: z.string(),
  }),
  z.looseObject({
    type: z.literal("transcript.user"),
    item_id: z.string().optional(),
    text: z.string(),
  }),
  z.looseObject({ type: z.literal("reply.started"), ...idFields }),
  z.looseObject({ type: z.literal("reply.audio"), data: z.string() }),
  z.looseObject({
    type: z.literal("transcript.agent.delta"),
    ...idFields,
    delta: z.string(),
    start_ms: z.number().nullable().optional(),
    end_ms: z.number().nullable().optional(),
  }),
  z.looseObject({
    type: z.literal("transcript.agent"),
    ...idFields,
    text: z.string(),
    interrupted: z.boolean().optional(),
  }),
  z.looseObject({
    type: z.literal("reply.done"),
    reply_id: z.string().optional(),
    status: z.enum(["completed", "interrupted"]),
  }),
  z.looseObject({
    type: z.literal("tool.call"),
    call_id: z.string(),
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
]);
const KNOWN_AGENT_TYPES = new Set<string>(KnownAgentSchema.options.map((o) => o.shape.type.value));
const UnknownAgentSchema = z
  .looseObject({ type: z.string() })
  .refine((e) => !KNOWN_AGENT_TYPES.has(e.type), "known type failed strict validation");

export const AgentServerEventSchema = z.union([KnownAgentSchema, UnknownAgentSchema]);

export type KnownAgentEvent = z.infer<typeof KnownAgentSchema>;
export type AgentServerEvent = z.infer<typeof AgentServerEventSchema>;

// ---------------------------------------------------------------- Voice Agent, client → server

export type AgentClientMessage =
  | { type: "session.update"; session: Record<string, unknown> }
  | { type: "session.resume"; session_id: string }
  | { type: "session.end" }
  | { type: "input.audio"; audio: string }
  | { type: "reply.create"; instructions?: string }
  | { type: "conversation.message"; role: "user" | "system"; content: string }
  | { type: "tool.result"; call_id: string; result: string; is_error?: boolean };

// ---------------------------------------------------------------- parsing helpers

/** Bad JSON, or a known type whose payload failed validation. */
export type Unparsed = { type: "unparsed"; raw: string; error: string };
/** Valid JSON with a type the client does not know yet. */
export type UnknownEvent = {
  type: "unknown";
  event_type: string;
  payload: Record<string, unknown>;
};

export type SttEvent = KnownSttMessage | UnknownEvent | Unparsed;
export type AgentEvent = KnownAgentEvent | UnknownEvent | Unparsed;

export function parseSttMessage(raw: string): SttEvent {
  return parseWith(SttServerMessageSchema, KNOWN_STT_TYPES, raw) as SttEvent;
}

export function parseAgentEvent(raw: string): AgentEvent {
  return parseWith(AgentServerEventSchema, KNOWN_AGENT_TYPES, raw) as AgentEvent;
}

function parseWith(
  schema: z.ZodType<{ type: string }>,
  known: Set<string>,
  raw: string,
): { type: string } | UnknownEvent | Unparsed {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { type: "unparsed", raw, error: err instanceof Error ? err.message : "invalid JSON" };
  }
  const result = schema.safeParse(json);
  if (!result.success) return { type: "unparsed", raw, error: result.error.message };
  if (known.has(result.data.type)) return result.data;
  return {
    type: "unknown",
    event_type: result.data.type,
    payload: result.data as Record<string, unknown>,
  };
}
