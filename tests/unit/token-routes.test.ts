import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as sttGet } from "@/app/api/token/stt/route";
import { GET as agentGet } from "@/app/api/token/agent/route";
import { resetRateLimit } from "@/lib/server/rate-limit";

const KEY = "route-test-key";

function req(path: string, ip = "9.9.9.9") {
  return new Request(`http://localhost${path}`, { headers: { "x-forwarded-for": ip } });
}

beforeEach(() => {
  resetRateLimit();
  vi.stubEnv("ASSEMBLYAI_API_KEY", KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/token/stt", () => {
  it("returns the minted token with no-store caching", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ token: "stt-1", expires_in_seconds: 60 })),
    );
    const res = await sttGet(req("/api/token/stt"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ token: "stt-1", expires_in_seconds: 60 });
  });

  it("rate limits the 21st request from one IP inside a minute", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ token: "stt-1", expires_in_seconds: 60 })),
    );
    for (let i = 0; i < 20; i++)
      expect((await sttGet(req("/api/token/stt", "1.1.1.1"))).status).toBe(200);
    const res = await sttGet(req("/api/token/stt", "1.1.1.1"));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: "rate_limited" });
    expect((await sttGet(req("/api/token/stt", "2.2.2.2"))).status).toBe(200);
  });

  it("maps an upstream failure to 502 without leaking the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    );
    const res = await sttGet(req("/api/token/stt"));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("token_mint_failed");
    expect(text).not.toContain(KEY);
  });
});

describe("GET /api/token/agent", () => {
  it("returns the minted token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ token: "agent-1" })),
    );
    const res = await agentGet(req("/api/token/agent"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ token: "agent-1" });
  });

  it("uses a rate-limit bucket separate from the STT route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ token: "agent-1", expires_in_seconds: 60 })),
    );
    for (let i = 0; i < 20; i++) await sttGet(req("/api/token/stt", "3.3.3.3"));
    expect((await agentGet(req("/api/token/agent", "3.3.3.3"))).status).toBe(200);
  });
});
