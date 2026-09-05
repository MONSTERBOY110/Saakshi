import { afterEach, describe, expect, it, vi } from "vitest";
import { mintAgentToken, mintSttToken } from "@/lib/aai/tokens";

const KEY = "test-key-123";

function fakeFetch(status: number, body: unknown) {
  const impl = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  return impl as unknown as typeof fetch & { mock: { calls: unknown[][] } };
}

afterEach(() => vi.unstubAllEnvs());

describe("mintSttToken", () => {
  it("calls the streaming token endpoint with the bare API key and parses the response", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", KEY);
    const f = fakeFetch(200, { token: "stt-tok", expires_in_seconds: 60 });
    await expect(mintSttToken(f)).resolves.toEqual({ token: "stt-tok", expires_in_seconds: 60 });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60&max_session_duration_seconds=3600",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(KEY);
  });

  it("throws on a non-2xx upstream response", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", KEY);
    await expect(mintSttToken(fakeFetch(401, { error: "Unauthorized" }))).rejects.toThrow(/401/);
  });

  it("throws when the upstream body does not match the schema", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", KEY);
    await expect(mintSttToken(fakeFetch(200, { nope: true }))).rejects.toThrow();
  });

  it("throws when the API key is missing", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "");
    await expect(
      mintSttToken(fakeFetch(200, { token: "x", expires_in_seconds: 60 })),
    ).rejects.toThrow(/ASSEMBLYAI_API_KEY/);
  });
});

describe("mintAgentToken", () => {
  it("calls the agents token endpoint with a Bearer header and parses the response", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", KEY);
    const f = fakeFetch(200, { token: "agent-tok" });
    await expect(mintAgentToken(f)).resolves.toEqual({ token: "agent-tok" });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://agents.assemblyai.com/v1/token?expires_in_seconds=60&max_session_duration_seconds=3600",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it("throws on a non-2xx upstream response", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", KEY);
    await expect(mintAgentToken(fakeFetch(500, {}))).rejects.toThrow(/500/);
  });
});
