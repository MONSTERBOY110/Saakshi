import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/certificate/route";
import { GET } from "@/app/api/certificate/[id]/route";
import { buildCertificateDraft } from "@/lib/cert/build";
import { verifyCertificate } from "@/lib/cert/chain";
import type { Certificate, CertificateDraft } from "@/lib/cert/schema";
import { getPack } from "@/lib/rules/load";
import { rebuildBoard } from "@/lib/session/board";
import { resetRateLimit } from "@/lib/server/rate-limit";
import type { StoredTurn } from "@/lib/session/transcript";

const pack = getPack("insurance-ulip-in");

const turn = (order: number, role: "advisor" | "customer", text: string): StoredTurn => ({
  order,
  text,
  final: true,
  formatted: true,
  speakerLabel: role === "advisor" ? "A" : "B",
  role,
  language: "en",
  startMs: order * 3000,
  endMs: order * 3000 + 2000,
  words: [],
  revised: false,
  pending: false,
});

async function draft(): Promise<CertificateDraft> {
  const turns = [
    turn(0, "advisor", "There is a five year lock-in and charges apply."),
    turn(1, "customer", "Theek hai."),
  ];
  return buildCertificateDraft({
    pack,
    board: rebuildBoard(pack, turns),
    turns,
    answers: [],
    setup: {
      packId: pack.id,
      advisorName: "Rahul",
      customerName: "Mrs. Sharma",
      productName: "ULIP",
      productTerms: [],
      judgeSolo: false,
    },
    session: {
      startedAt: "2026-09-06T09:00:00.000Z",
      endedAt: "2026-09-06T09:03:00.000Z",
      sttSessionId: "stt-9",
      agentSessionId: "sess-9",
      gaps: [],
    },
    interventions: [],
    demo: true,
  });
}

function post(body: unknown, ip = "5.5.5.5") {
  return new Request("http://localhost/api/certificate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetRateLimit();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("KV_REST_API_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://saakshi-1.vercel.app");
});

describe("POST /api/certificate", () => {
  it("assigns an id, computes a hash that verifies, and returns the verify URL", async () => {
    const res = await POST(post(await draft()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(body.certificate_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.url).toBe(`https://saakshi-1.vercel.app/verify/${body.id}`);

    const stored = await GET(
      new Request(`http://localhost/api/certificate/${body.id}`, {
        headers: { "x-forwarded-for": "5.5.5.5" },
      }),
      { params: Promise.resolve({ id: body.id }) },
    );
    expect(stored.status).toBe(200);
    const cert = (await stored.json()) as Certificate;
    expect(cert.certificate_hash).toBe(body.certificate_hash);
    await expect(verifyCertificate(cert)).resolves.toMatchObject({ valid: true });
  });

  it("ignores any hash or id the client tries to supply", async () => {
    const d = (await draft()) as unknown as Record<string, unknown>;
    const res = await POST(post({ ...d, id: "attacker", certificate_hash: "0".repeat(64) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).not.toBe("attacker");
    expect(body.certificate_hash).not.toBe("0".repeat(64));
  });

  it("rejects a draft whose chain head does not match its own turns", async () => {
    const d = await draft();
    const res = await POST(
      post({ ...d, turns_digest: { ...d.turns_digest, chain_head: "f".repeat(64) } }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("chain_mismatch");
  });

  it("rejects a malformed body", async () => {
    expect((await POST(post({ version: "1.0" }))).status).toBe(400);
  });

  it("rate limits after twenty writes from one address", async () => {
    const d = await draft();
    for (let i = 0; i < 20; i++) expect((await POST(post(d, "9.9.9.9"))).status).toBe(200);
    expect((await POST(post(d, "9.9.9.9"))).status).toBe(429);
  });
});

describe("GET /api/certificate/[id]", () => {
  it("returns 404 for an unknown or malformed id", async () => {
    const req = new Request("http://localhost/api/certificate/x", {
      headers: { "x-forwarded-for": "4.4.4.4" },
    });
    expect((await GET(req, { params: Promise.resolve({ id: "short" }) })).status).toBe(404);
    expect((await GET(req, { params: Promise.resolve({ id: "abcdefghijklmnop" }) })).status).toBe(
      404,
    );
  });
});
