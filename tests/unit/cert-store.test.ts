import { afterEach, describe, expect, it, vi } from "vitest";
import { getCertificateStore, memoryStore, CERTIFICATE_TTL_SECONDS } from "@/lib/cert/store";
import type { Certificate } from "@/lib/cert/schema";

const cert = { id: "cert-1", version: "1.0", certificate_hash: "abc" } as unknown as Certificate;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("certificate store", () => {
  it("falls back to memory when Upstash is not configured", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    const store = getCertificateStore();
    expect(store.kind).toBe("memory");
    await store.put(cert);
    await expect(store.get("cert-1")).resolves.toEqual(cert);
    await expect(store.get("missing")).resolves.toBeNull();
  });

  it("writes to Upstash with a bearer token and a ninety day expiry", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://eu1.upstash.io/");
    vi.stubEnv("KV_REST_API_TOKEN", "tok");
    const fetchImpl = vi.fn(async () => Response.json({ result: "OK" }));
    const store = getCertificateStore(fetchImpl as unknown as typeof fetch);
    expect(store.kind).toBe("upstash");
    await store.put(cert);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://eu1.upstash.io");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual([
      "SET",
      "cert:cert-1",
      JSON.stringify(cert),
      "EX",
      String(CERTIFICATE_TTL_SECONDS),
    ]);
  });

  it("reads a certificate back from Upstash and returns null when absent", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://eu1.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "tok");
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      const [command] = JSON.parse(init.body as string) as string[];
      if (command !== "GET") return Response.json({ result: "OK" });
      return Response.json({ result: JSON.stringify(cert) });
    });
    const store = getCertificateStore(fetchImpl as unknown as typeof fetch);
    await expect(store.get("cert-1")).resolves.toEqual(cert);

    const empty = getCertificateStore(
      vi.fn(async () => Response.json({ result: null })) as unknown as typeof fetch,
    );
    await expect(empty.get("nope")).resolves.toBeNull();
  });

  it("throws when Upstash rejects a write, so the route can report it", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://eu1.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "tok");
    const store = getCertificateStore(
      vi.fn(async () => new Response("no", { status: 500 })) as unknown as typeof fetch,
    );
    await expect(store.put(cert)).rejects.toThrow(/500/);
  });

  it("keeps certificates separate by id in memory", async () => {
    const store = memoryStore();
    await store.put(cert);
    await store.put({ ...cert, id: "cert-2" });
    await expect(store.get("cert-2")).resolves.toMatchObject({ id: "cert-2" });
  });
});
