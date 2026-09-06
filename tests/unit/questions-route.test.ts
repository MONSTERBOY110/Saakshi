import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/teachback/questions/route";
import { resetModelCapabilities } from "@/lib/analyzer/gateway";
import { resetRateLimit } from "@/lib/server/rate-limit";

const body = {
  pack_id: "insurance-ulip-in",
  context: { advisor: "Rahul", customer: "Mrs. Sharma", product: "ULIP" },
  board: {
    checkpoints: [
      { id: "lock_in_5y", status: "met" },
      { id: "free_look_30", status: "pending" },
    ],
    violations: [{ id: "guaranteed_returns", label: "Guaranteed or assured returns" }],
  },
  advisor_digest:
    "There is a five year lock-in. The returns are guaranteed, 12%. There are charges including premium allocation.",
};

function post(payload: unknown = body, ip = "3.3.3.3") {
  return new Request("http://localhost/api/teachback/questions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(payload),
  });
}

function gatewayReturning(questions: unknown) {
  return vi.fn(async () =>
    Response.json({
      request_id: "q1",
      choices: [{ message: { content: JSON.stringify({ questions }) } }],
    }),
  );
}

beforeEach(() => {
  resetRateLimit();
  resetModelCapabilities();
  vi.stubEnv("ASSEMBLYAI_API_KEY", "key");
  vi.stubEnv("LLM_ANALYZER_MODELS", "test-model");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/teachback/questions", () => {
  it("returns the model's questions when they are usable", async () => {
    vi.stubGlobal(
      "fetch",
      gatewayReturning([
        {
          id: "q1",
          topic: "market_risk",
          question_en: "What happens to your money if the market falls?",
          expected_points: ["value can fall"],
          hint_hi: "Market gire to kya hoga?",
        },
        {
          id: "q2",
          topic: "lock_in",
          question_en: "For how long is your money locked in?",
          expected_points: ["five years"],
          hint_hi: "Kitne saal?",
        },
        {
          id: "q3",
          topic: "charges",
          question_en: "What charges come out of your premium?",
          expected_points: ["allocation"],
          hint_hi: "Kaunse charges?",
        },
      ]),
    );
    const res = await POST(post());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.source).toBe("llm");
    expect(json.model).toBe("test-model");
    expect(json.questions.map((q: { id: string }) => q.id)).toEqual(["q1", "q2", "q3"]);
    expect(json.questions[0].question).toContain("market falls");
  });

  it("replaces a question that invents a number, keeping the good ones", async () => {
    vi.stubGlobal(
      "fetch",
      gatewayReturning([
        {
          id: "q1",
          topic: "market_risk",
          question_en: "Is the guaranteed return 18 percent every year?",
          expected_points: [],
          hint_hi: "",
        },
        {
          id: "q2",
          topic: "lock_in",
          question_en: "For how long is your money locked in?",
          expected_points: ["five years"],
          hint_hi: "Kitne saal?",
        },
      ]),
    );
    const json = await (await POST(post())).json();
    expect(json.source).toBe("mixed");
    expect(json.questions.some((q: { question: string }) => q.question.includes("18"))).toBe(false);
    expect(json.questions.length).toBeGreaterThanOrEqual(3);
  });

  it("falls back to the pack when the gateway fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    const json = await (await POST(post())).json();
    expect(json.source).toBe("pack");
    expect(json.questions.length).toBeGreaterThanOrEqual(3);
    expect(json.model).toBeUndefined();
  });

  it("falls back to the pack when no API key is configured", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "");
    const json = await (await POST(post())).json();
    expect(json.source).toBe("pack");
  });

  it("asks about a flagged topic first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    const json = await (await POST(post())).json();
    expect(["market_risk", "lock_in"]).toContain(json.questions[0].topic);
  });

  it("rejects a malformed body and an unknown pack", async () => {
    expect((await POST(post({ pack_id: "insurance-ulip-in" }))).status).toBe(400);
    expect((await POST(post({ ...body, pack_id: "nope" }))).status).toBe(400);
  });

  it("keeps every spoken question short and free of markdown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    const json = await (await POST(post())).json();
    for (const q of json.questions as Array<{ question: string }>) {
      expect(q.question.split(/\s+/).length).toBeLessThanOrEqual(18);
      expect(q.question).not.toMatch(/[!*_#`]/);
    }
  });
});
