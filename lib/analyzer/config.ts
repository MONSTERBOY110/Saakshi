// LLM configuration read from the environment. Kept out of the route files because Next.js route
// modules may only export the HTTP handlers and a few reserved names.
//
// Two kinds of endpoint, tried in order (docs/decisions.md, 2026-09-11):
// 1. An OpenAI-compatible provider (Groq by default) when LLM_PROVIDER_API_KEY is set. The hackathon
//    account's AssemblyAI LLM Gateway is limited to one 4B model at two calls a minute with no
//    response_format, so the provider carries the analyzer notes and the teach-back questions.
// 2. The AssemblyAI LLM Gateway, always last, so nothing breaks when the provider is down or unset.
// AssemblyAI stays the whole voice stack; only the text-in, JSON-out calls move.

export type Env = Record<string, string | undefined>;

export type StructuredMode = "json_schema" | "json_object" | "prompt";

export type LlmEndpoint = {
  /** `${provider}:${model}`, for logs and reports. */
  id: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Groq and other OpenAI-compatible hosts want `Bearer`; the AssemblyAI gateway takes the bare key. */
  auth: "bearer" | "bare";
  /** How the endpoint is asked for JSON. json_schema falls back to prompt if the model refuses it. */
  structured: StructuredMode;
  /** Provider-specific request fields merged into the body. */
  extras?: Record<string, unknown>;
  /** Raise max_tokens to at least this, for models whose reasoning shares the completion budget. */
  minCompletionTokens?: number;
};

/**
 * How long the server waits for a model. `trd.md` section 6.2 said 2500 ms because the analyzer
 * once sat on the intervention path; it no longer does (the analyzer is advisory), and the gateway's
 * only reachable model answers in about 1.9 s at the median, so layer 2 gets room to finish.
 */
export const ANALYZE_TIMEOUT_MS = Number(process.env.LLM_ANALYZER_TIMEOUT_MS ?? 6000);

export const GATEWAY_BASE_URL_DEFAULT = "https://llm-gateway.assemblyai.com/v1";
export const PROVIDER_BASE_URL_DEFAULT = "https://api.groq.com/openai/v1";
/**
 * Groq production models this account can reach (GET /models on 2026-09-11): both gpt-oss sizes
 * enforce a strict json_schema. Llama 3.3 70B answered 404 on the free tier, so it is not here.
 */
export const PROVIDER_MODELS_DEFAULT = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

/**
 * gpt-oss reasons before it answers. Low effort keeps the call near a second, the reasoning is not
 * returned, and a completion floor stops the reasoning budget from truncating the JSON, which Groq
 * then reports as "Failed to validate JSON".
 */
export const GPT_OSS_EXTRAS: Record<string, unknown> = {
  reasoning_effort: "low",
  include_reasoning: false,
};
export const GPT_OSS_MIN_COMPLETION_TOKENS = 2048;
export const isGptOss = (model: string): boolean => /gpt-oss/i.test(model);

/** What the AssemblyAI gateway accepts beyond the OpenAI shape (verified live 2026-09-06). */
export const ASSEMBLYAI_EXTRAS: Record<string, unknown> = {
  post_processing_steps: [{ type: "json-repair" }],
  fallback_config: { retry: false },
};

/**
 * Gateway models tried in order. The hackathon account currently has LLM Gateway access to
 * qwen3.5-4b-32k-fast only (see docs/decisions.md), so it is last but reachable; the gateway
 * client remembers which models this account cannot use and skips them after the first attempt.
 */
export function analyzerModels(env: Env = process.env): string[] {
  const raw =
    env.LLM_ANALYZER_MODELS ??
    [
      env.LLM_ANALYZER_MODEL ?? "gemini-3.5-flash-lite",
      env.LLM_ANALYZER_FALLBACK_MODEL ?? "claude-haiku-4-5-20251001",
      "qwen3.5-4b-32k-fast",
    ].join(",");
  return splitList(raw) ?? [];
}

export function gatewayBaseUrl(env: Env = process.env): string {
  return trimSlash(env.LLM_GATEWAY_BASE_URL ?? GATEWAY_BASE_URL_DEFAULT);
}

/**
 * Which JSON mode a model gets. On Groq only the gpt-oss and qwen3.8 models enforce a schema;
 * everything else gets json_object mode with the shape described in the prompt.
 * LLM_PROVIDER_STRUCTURED overrides for a provider this heuristic does not know.
 */
export function structuredModeFor(model: string, override?: string): StructuredMode {
  if (override === "json_schema" || override === "json_object" || override === "prompt") {
    return override;
  }
  return /gpt-oss|qwen3\.8/i.test(model) ? "json_schema" : "json_object";
}

export function providerEndpoints(env: Env = process.env): LlmEndpoint[] {
  const apiKey = env.LLM_PROVIDER_API_KEY?.trim();
  if (!apiKey) return [];
  const baseUrl = trimSlash(env.LLM_PROVIDER_BASE_URL ?? PROVIDER_BASE_URL_DEFAULT);
  const models = splitList(env.LLM_PROVIDER_MODELS) ?? PROVIDER_MODELS_DEFAULT;
  const provider = env.LLM_PROVIDER_NAME?.trim() || providerNameFrom(baseUrl);
  return models.map((model) => ({
    id: `${provider}:${model}`,
    provider,
    baseUrl,
    apiKey,
    model,
    auth: "bearer" as const,
    structured: structuredModeFor(model, env.LLM_PROVIDER_STRUCTURED),
    ...(isGptOss(model)
      ? { extras: GPT_OSS_EXTRAS, minCompletionTokens: GPT_OSS_MIN_COMPLETION_TOKENS }
      : {}),
  }));
}

export function assemblyaiEndpoints(
  env: Env = process.env,
  models: string[] = analyzerModels(env),
): LlmEndpoint[] {
  const apiKey = env.ASSEMBLYAI_API_KEY?.trim();
  if (!apiKey) return [];
  const baseUrl = gatewayBaseUrl(env);
  return models.map((model) => ({
    id: `assemblyai:${model}`,
    provider: "assemblyai",
    baseUrl,
    apiKey,
    model,
    auth: "bare" as const,
    structured: "json_schema" as const,
    extras: ASSEMBLYAI_EXTRAS,
  }));
}

/**
 * Every endpoint worth trying, best first. Both purposes share the list today; the parameter is
 * kept so a future per-purpose override has somewhere to live and so logs say which call it was.
 */
export function llmEndpoints(
  purpose: "analyzer" | "questions",
  env: Env = process.env,
): LlmEndpoint[] {
  void purpose;
  return [...providerEndpoints(env), ...assemblyaiEndpoints(env)];
}

function providerNameFrom(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname;
    if (host.includes("groq")) return "groq";
    if (host.includes("nvidia")) return "nvidia";
    if (host.includes("openai.com")) return "openai";
    if (host.includes("assemblyai")) return "assemblyai";
    return host.split(".").slice(-2, -1)[0] ?? "provider";
  } catch {
    return "provider";
  }
}

function splitList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const items = raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
