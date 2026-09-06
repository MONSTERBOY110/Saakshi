import { beforeEach, describe, expect, it, vi } from "vitest";
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
