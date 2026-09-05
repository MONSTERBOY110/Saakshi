// Inline Voice Agent session configuration. Verified against the Voice Agent WebSocket spec on
// 2026-09-05: input.format / output.format carry only { encoding: "audio/pcm" } (24 kHz PCM16 is
// implied by the encoding, there is no sample_rate field); greeting and output.voice are immutable
// after session.ready; system_prompt, tools, input.keyterms and input.turn_detection are mutable.
export const AGENT_WS_BASE = "wss://agents.assemblyai.com/v1/ws";

export const AGENT_VOICES = ["anna", "jane", "mary", "vera", "george"] as const;
export type AgentVoice = (typeof AGENT_VOICES)[number];

/** Human-feeling defaults from the gotchas file. Setting these disables adaptive endpointing. */
export const BASELINE_TURN_DETECTION = {
  vad_threshold: 0.5,
  min_silence: 1400,
  max_silence: 4000,
  interrupt_response: true,
} as const;

/** Applied after the agent asks a question so the customer has time to think. */
export const QUESTION_TURN_DETECTION = {
  ...BASELINE_TURN_DETECTION,
  min_silence: 2200,
  max_silence: 6000,
} as const;

export type TurnDetection = {
  vad_threshold: number;
  min_silence: number;
  max_silence: number;
  interrupt_response: boolean;
};

export type AgentToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execution_mode?: "interactive" | "hold";
  timeout_seconds?: number;
};

export type AgentSessionConfig = {
  system_prompt: string;
  greeting: string;
  input: {
    format: { encoding: "audio/pcm" };
    keyterms: string[];
    language_codes?: string[];
    voice_focus: "far-field";
    turn_detection: TurnDetection;
  };
  output: { voice: AgentVoice; format: { encoding: "audio/pcm" }; volume: number };
  tools: AgentToolDefinition[];
};

export type AgentSessionOpts = {
  systemPrompt: string;
  greeting: string;
  keyterms: string[];
  languageCodes?: string[];
  voice?: AgentVoice;
};

export const AGENT_KEYTERM_MAX = 100;

/** Anything the agent speaks goes straight to TTS: no markdown, no exclamation marks. */
export function assertSpeakable(text: string): void {
  if (/[!*_#`]/.test(text)) {
    throw new Error("agent speech must not contain markdown or exclamation marks");
  }
}

export function buildInitialSession(o: AgentSessionOpts): {
  type: "session.update";
  session: AgentSessionConfig;
} {
  assertSpeakable(o.greeting);
  const input: AgentSessionConfig["input"] = {
    format: { encoding: "audio/pcm" },
    keyterms: o.keyterms.slice(0, AGENT_KEYTERM_MAX),
    voice_focus: "far-field",
    turn_detection: { ...BASELINE_TURN_DETECTION },
  };
  if (o.languageCodes && o.languageCodes.length > 0) input.language_codes = [...o.languageCodes];
  return {
    type: "session.update",
    session: {
      system_prompt: o.systemPrompt,
      greeting: o.greeting,
      input,
      output: { voice: o.voice ?? "anna", format: { encoding: "audio/pcm" }, volume: 100 },
      tools: [],
    },
  };
}
