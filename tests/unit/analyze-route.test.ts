import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/analyze/route";
import { resetRateLimit } from "@/lib/server/rate-limit";

const validBody = {
  pack_id: "insurance-ulip-in",
  context: { advisor: "Rahul", customer: "Mrs. Sharma", product: "ULIP" },
  turns: [{ order: 1, role: "advisor", text: "There is a five year lock-in.", start_ms: 1000 }],
};

const gatewayOk = () =>
  Response.json({
    request_id: "r1",
    choices: [
      {
        message: {
          content: JSON.stringify({
            checkpoints_satisfied: [
              { id: "lock_in_5y", turn_order: 1, quote: "five year lock-in", confidence: 0.9 },
            ],
            violations: [],
            customer_questions_unanswered: [],
            language_mix: "en",
          }),
        },
      },
    ],
  });

function post(body: unknown, ip = "7.7.7.7") {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  resetRateLimit();
  vi.stubEnv("ASSEMBLYAI_API_KEY", "route-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/analyze", () => {
  it("returns the sanitized analysis with model, latency and request id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => gatewayOk()),
    );
    const res = await POST(post(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.analysis.checkpoints_satisfied.map((c: { id: string }) => c.id)).toEqual([
      "lock_in_5y",
    ]);
    expect(json.model).toBe("gemini-3.5-flash-lite");
    expect(json.request_id).toBe("r1");
    expect(typeof json.latency_ms).toBe("number");
  });

  it("rejects malformed bodies and unknown packs with 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => gatewayOk()),
    );
    expect((await POST(post("{not json"))).status).toBe(400);
    expect((await POST(post({ ...validBody, turns: [] }))).status).toBe(400);
    expect((await POST(post({ ...validBody, pack_id: "nope" }))).status).toBe(400);
  });

  it("returns 502 when both gateway models fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    const res = await POST(post(validBody));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("analyzer_unavailable");
  });

  it("rate limits at 60 requests per minute per IP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => gatewayOk()),
    );
    for (let i = 0; i < 60; i++) expect((await POST(post(validBody, "1.2.3.4"))).status).toBe(200);
    expect((await POST(post(validBody, "1.2.3.4"))).status).toBe(429);
  });
});
