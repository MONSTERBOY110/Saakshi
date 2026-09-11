import { beforeEach, describe, expect, it, vi } from "vitest";
import { llmEndpoints } from "@/lib/analyzer/config";
import {
  analyzeWithGateway,
  resetModelCapabilities,
  type GatewayDeps,
} from "@/lib/analyzer/gateway";
import type { Analysis, AnalyzeRequest } from "@/lib/analyzer/schema";
import { getPack } from "@/lib/rules/load";

const pack = getPack("insurance-ulip-in");
const req: AnalyzeRequest = {
  pack_id: pack.id,
  context: { advisor: "Rahul", customer: "Mrs. Sharma", product: "ULIP" },
  turns: [
    { order: 8, role: "customer", text: "Isme paisa kab nikal sakti hoon?", start_ms: 40000 },
    {
      order: 9,
      role: "advisor",
      text: "Anytime, madam, and the returns are guaranteed, 12%.",
      start_ms: 43000,
    },
  ],
};
const analysis: Analysis = {
  checkpoints_satisfied: [],
  violations: [
    {
      id: "guaranteed_returns",
      turn_order: 9,
      quote: "the returns are guaranteed, 12%",
      severity: "critical",
      confidence: 0.96,
      rationale: "Guaranteed returns promised on a market-linked plan.",
    },
    { id: "made_up", turn_order: 9, quote: "x", severity: "high", confidence: 0.9, rationale: "" },
    {
      id: "withdraw_anytime",
      turn_order: 8,
      quote: "kab nikal",
      severity: "critical",
      confidence: 0.9,
      rationale: "customer turn",
    },
  ],
  customer_questions_unanswered: [
    { turn_order: 8, quote: "Isme paisa kab nikal sakti hoon?", topic: "withdrawal" },
  ],
  language_mix: "mixed",
};

function gatewayResponse(content: unknown, requestId = "req_1") {
  return new Response(
    JSON.stringify({
      request_id: requestId,
      choices: [
        {
          message: {
            role: "assistant",
            content: typeof content === "string" ? content : JSON.stringify(content),
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function deps(fetchImpl: typeof fetch, timeoutMs = 2500): GatewayDeps {
  return {
    apiKey: "key-123",
    baseUrl: "https://llm-gateway.assemblyai.com/v1",
    models: ["gemini-3.5-flash-lite", "claude-haiku-4-5-20251001"],
    timeoutMs,
    fetchImpl,
  };
}

beforeEach(() => resetModelCapabilities());

describe("analyzeWithGateway", () => {
  it("posts a strict structured-output request with the bare API key and sanitizes the reply", async () => {
    const f = vi.fn(async () => gatewayResponse(analysis));
    const out = await analyzeWithGateway(deps(f as unknown as typeof fetch), req, pack);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.model).toBe("gemini-3.5-flash-lite");
    expect(out.requestId).toBe("req_1");
    // Unknown id dropped; violation on the customer turn dropped; the real one kept.
    expect(out.analysis.violations.map((v) => `${v.id}@${v.turn_order}`)).toEqual([
      "guaranteed_returns@9",
    ]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm-gateway.assemblyai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("key-123");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gemini-3.5-flash-lite");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(body.post_processing_steps).toEqual([{ type: "json-repair" }]);
    expect(body.max_tokens).toBe(600);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("guaranteed_returns");
    expect(body.messages[1].content).toContain("Anytime, madam");
  });

  it("falls back to the second model when the first returns 5xx", async () => {
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.model === "gemini-3.5-flash-lite") return new Response("boom", { status: 500 });
      return gatewayResponse(analysis, "req_fb");
    });
    const out = await analyzeWithGateway(deps(f as unknown as typeof fetch), req, pack);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.model).toBe("claude-haiku-4-5-20251001");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("falls back when the first model exceeds the timeout", async () => {
    const f = vi.fn((_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.model !== "gemini-3.5-flash-lite") return Promise.resolve(gatewayResponse(analysis));
      return new Promise<Response>((resolve, reject) => {
        const t = setTimeout(() => resolve(gatewayResponse(analysis)), 2000);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
    const out = await analyzeWithGateway(deps(f as unknown as typeof fetch, 30), req, pack);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.model).toBe("claude-haiku-4-5-20251001");
  });

  it("reports failure when both models return unusable content", async () => {
    const f = vi.fn(async () => gatewayResponse("not json at all"));
    const out = await analyzeWithGateway(deps(f as unknown as typeof fetch), req, pack);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("gemini-3.5-flash-lite");
    expect(out.error).toContain("claude-haiku-4-5-20251001");
  });
});

describe("analyzeWithGateway across providers (Groq first, AssemblyAI gateway last)", () => {
  // An explicit model list, so the json_object path (any OpenAI-compatible model without schema
  // enforcement) stays covered even though the shipped default is two gpt-oss models.
  const endpoints = llmEndpoints("analyzer", {
    LLM_PROVIDER_API_KEY: "gsk_test",
    LLM_PROVIDER_MODELS: "openai/gpt-oss-120b,llama-3.3-70b-versatile",
    ASSEMBLYAI_API_KEY: "aai_test",
    LLM_ANALYZER_MODELS: "qwen3.5-4b-32k-fast",
  });

  function groqError(status: number, message: string) {
    return new Response(JSON.stringify({ error: { message, type: "x", code: "y" } }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("asks Groq gpt-oss with Bearer auth, a strict schema, and no AssemblyAI-only fields", async () => {
    const f = vi.fn(async () => gatewayResponse(analysis, "chatcmpl_1"));
    const out = await analyzeWithGateway(
      { endpoints, timeoutMs: 2500, fetchImpl: f as unknown as typeof fetch },
      req,
      pack,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.endpoint).toBe("groq:openai/gpt-oss-120b");
    expect(out.provider).toBe("groq");
    expect(out.mode).toBe("json_schema");
    expect(out.structured).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer gsk_test");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("openai/gpt-oss-120b");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body).not.toHaveProperty("post_processing_steps");
    expect(body).not.toHaveProperty("fallback_config");
    // gpt-oss reasons before it answers: low effort, reasoning not returned, and a completion
    // floor so the reasoning budget cannot truncate the JSON.
    expect(body.reasoning_effort).toBe("low");
    expect(body.include_reasoning).toBe(false);
    expect(body.max_tokens).toBe(2048);
  });

  it("retries the same gpt-oss model in prose when its strict generation fails validation", async () => {
    let calls = 0;
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      calls += 1;
      const body = JSON.parse(init.body as string);
      if (body.model === "openai/gpt-oss-120b" && body.response_format?.type === "json_schema") {
        return new Response(
          JSON.stringify({
            error: {
              message:
                "Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
              type: "invalid_request_error",
              code: "json_validate_failed",
              failed_generation: '{"checkpoints_satisfied": [{"id": "lock',
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return gatewayResponse(analysis, "chatcmpl_retry");
    });
    const out = await analyzeWithGateway(
      { endpoints, timeoutMs: 2500, fetchImpl: f as unknown as typeof fetch },
      req,
      pack,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.endpoint).toBe("groq:openai/gpt-oss-120b");
    expect(out.mode).toBe("prompt");
    expect(calls).toBe(2);
    const [, init] = f.mock.calls[1] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("response_format");
    expect(body.messages[0].content).toContain("Return one JSON object");
    // A one-off validation failure does not mark the model as refusing schemas.
    resetModelCapabilities();
  });

  it("uses json_object mode with the shape in the prompt for Llama when gpt-oss is rate limited", async () => {
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.model === "openai/gpt-oss-120b") return groqError(429, "Rate limit reached");
      return gatewayResponse(analysis, "chatcmpl_2");
    });
    const out = await analyzeWithGateway(
      { endpoints, timeoutMs: 2500, fetchImpl: f as unknown as typeof fetch },
      req,
      pack,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.endpoint).toBe("groq:llama-3.3-70b-versatile");
    expect(out.mode).toBe("json_object");
    expect(out.structured).toBe(false);
    const [, init] = f.mock.calls[1] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toContain("Return one JSON object");
  });

  it("falls through to the AssemblyAI gateway, bare key and json-repair, when Groq is down", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.startsWith("https://api.groq.com")) return groqError(503, "Service unavailable");
      return gatewayResponse(analysis, "req_aai");
    });
    const out = await analyzeWithGateway(
      { endpoints, timeoutMs: 2500, fetchImpl: f as unknown as typeof fetch },
      req,
      pack,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.endpoint).toBe("assemblyai:qwen3.5-4b-32k-fast");
    const [url, init] = f.mock.calls[2] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm-gateway.assemblyai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("aai_test");
    const body = JSON.parse(init.body as string);
    expect(body.post_processing_steps).toEqual([{ type: "json-repair" }]);
  });

  it("remembers a model the provider says does not exist and skips it next time", async () => {
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.model === "openai/gpt-oss-120b") {
        return groqError(404, "The model `openai/gpt-oss-120b` does not exist");
      }
      return gatewayResponse(analysis);
    });
    const deps = { endpoints, timeoutMs: 2500, fetchImpl: f as unknown as typeof fetch };
    await analyzeWithGateway(deps, req, pack);
    await analyzeWithGateway(deps, req, pack);
    const models = f.mock.calls.map(
      (c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string).model,
    );
    expect(models).toEqual([
      "openai/gpt-oss-120b",
      "llama-3.3-70b-versatile",
      "llama-3.3-70b-versatile",
    ]);
  });

  it("reports the error when no endpoint is configured", async () => {
    const out = await analyzeWithGateway({ endpoints: [], timeoutMs: 100 }, req, pack);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("no LLM endpoint configured");
  });
});
