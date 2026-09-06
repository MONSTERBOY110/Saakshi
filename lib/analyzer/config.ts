// Analyzer configuration read from the environment. Kept out of the route file because Next.js
// route modules may only export the HTTP handlers and a few reserved names.

/**
 * How long the server waits for a model. `trd.md` section 6.2 said 2500 ms because the analyzer
 * once sat on the intervention path; it no longer does (critical claims are deterministic and fire
 * in milliseconds), and the only model this account can reach answers in about 1.9 s at the median,
 * so a 2500 ms cap threw away roughly half of the useful results. Layer 2 now gets room to finish.
 */
export const ANALYZE_TIMEOUT_MS = Number(process.env.LLM_ANALYZER_TIMEOUT_MS ?? 6000);

export const GATEWAY_BASE_URL_DEFAULT = "https://llm-gateway.assemblyai.com/v1";

/**
 * Models tried in order. The hackathon account currently has LLM Gateway access to
 * qwen3.5-4b-32k-fast only (see docs/decisions.md), so it is last but reachable; the gateway
 * client remembers which models this account cannot use and skips them after the first attempt.
 */
export function analyzerModels(): string[] {
  const raw =
    process.env.LLM_ANALYZER_MODELS ??
    [
      process.env.LLM_ANALYZER_MODEL ?? "gemini-3.5-flash-lite",
      process.env.LLM_ANALYZER_FALLBACK_MODEL ?? "claude-haiku-4-5-20251001",
      "qwen3.5-4b-32k-fast",
    ].join(",");
  return raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

export function gatewayBaseUrl(): string {
  return process.env.LLM_GATEWAY_BASE_URL ?? GATEWAY_BASE_URL_DEFAULT;
}
