import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "@/lib/cert/canonical";
import {
  buildTurnDigest,
  certificateHash,
  chainHead,
  verifyCertificate,
  type ChainTurn,
  type DigestTurn,
} from "@/lib/cert/chain";

// FR-9: h0 = sha256(pack_id | pack_version | stt_session_id)
//       hi = sha256(h(i-1) | turn_order | speaker_role | transcript_hash | start_ms | end_ms)
// with fields joined by "|" as UTF-8 and hashes as lower-case hex.
const seed = { packId: "insurance-ulip-in", packVersion: "1.0.0", sttSessionId: "sess-abc" };

const turns: ChainTurn[] = [
  { order: 0, role: "advisor", transcript: "Good morning, Mrs. Sharma.", startMs: 0, endMs: 1500 },
  { order: 1, role: "customer", transcript: "Namaste.", startMs: 2000, endMs: 2600 },
  { order: 2, role: "advisor", transcript: "There is a 5-year lock-in.", startMs: 3000, endMs: 5200 },
];

describe("chainHead", () => {
  it("computes h0 exactly as the specification states", async () => {
    const expected = await sha256Hex("insurance-ulip-in|1.0.0|sess-abc");
    await expect(chainHead(seed, [])).resolves.toBe(expected);
  });

  it("folds each turn into the previous hash in the documented order", async () => {
    const h0 = await sha256Hex("insurance-ulip-in|1.0.0|sess-abc");
    const t0 = turns[0]!;
    const th0 = await sha256Hex(t0.transcript);
    const h1 = await sha256Hex(`${h0}|0|advisor|${th0}|0|1500`);
    await expect(chainHead(seed, [t0])).resolves.toBe(h1);
  });

  it("depends on order, so swapping two turns changes the head", async () => {
    const straight = await chainHead(seed, turns);
    const swapped = await chainHead(seed, [turns[1]!, turns[0]!, turns[2]!]);
    expect(straight).not.toBe(swapped);
  });

  it("changes when a single character of a transcript changes", async () => {
    const before = await chainHead(seed, turns);
    const edited = turns.map((t) => (t.order === 2 ? { ...t, transcript: "There is a 4-year lock-in." } : t));
    await expect(chainHead(seed, edited)).resolves.not.toBe(before);
  });

  it("changes when a speaker role or a timestamp changes", async () => {
    const before = await chainHead(seed, turns);
    const role = turns.map((t) => (t.order === 1 ? { ...t, role: "advisor" as const } : t));
    const time = turns.map((t) => (t.order === 1 ? { ...t, endMs: 2601 } : t));
    await expect(chainHead(seed, role)).resolves.not.toBe(before);
    await expect(chainHead(seed, time)).resolves.not.toBe(before);
  });

  it("is reproducible from the stored digest alone, without the transcripts", async () => {
    const fromTurns = await chainHead(seed, turns);
    const digest = await buildTurnDigest(turns);
    expect(digest.map((d) => d.turn_order)).toEqual([0, 1, 2]);
    expect(digest.every((d) => /^[0-9a-f]{64}$/.test(d.transcript_hash))).toBe(true);
    await expect(chainHead(seed, digest)).resolves.toBe(fromTurns);
  });
});

describe("certificateHash", () => {
  const certificate = {
    id: "abc123",
    version: "1.0" as const,
    pack: { id: seed.packId, version: seed.packVersion, jurisdiction: "IN" },
    created_at: "2026-09-06T09:00:00.000Z",
    certificate_hash: "",
  };

  it("hashes the canonical JSON of the certificate with the hash field emptied", async () => {
    const expected = await sha256Hex(canonicalJson({ ...certificate, certificate_hash: "" }));
    await expect(certificateHash(certificate)).resolves.toBe(expected);
  });

  it("ignores whatever the hash field already held", async () => {
    const a = await certificateHash({ ...certificate, certificate_hash: "" });
    const b = await certificateHash({ ...certificate, certificate_hash: "stale" });
    expect(a).toBe(b);
  });

  it("ignores key order in the stored object", async () => {
    const reordered = {
      certificate_hash: "",
      created_at: certificate.created_at,
      pack: { jurisdiction: "IN", version: seed.packVersion, id: seed.packId },
      version: certificate.version,
      id: certificate.id,
    };
    await expect(certificateHash(reordered)).resolves.toBe(await certificateHash(certificate));
  });
});

describe("verifyCertificate", () => {
  async function makeCertificate() {
    const digest: DigestTurn[] = await buildTurnDigest(turns);
    const head = await chainHead(seed, digest);
    const base = {
      id: "cert-1",
      version: "1.0" as const,
      pack: { id: seed.packId, version: seed.packVersion, jurisdiction: "IN" },
      session: { stt_session_id: seed.sttSessionId },
      turns: digest,
      turns_digest: { count: digest.length, chain_head: head },
      created_at: "2026-09-06T09:00:00.000Z",
      certificate_hash: "",
    };
    return { ...base, certificate_hash: await certificateHash(base) };
  }

  it("reports VALID for an untouched certificate", async () => {
    await expect(verifyCertificate(await makeCertificate())).resolves.toEqual({
      valid: true,
      chainOk: true,
      hashOk: true,
    });
  });

  it("reports TAMPERED when one character of a stored transcript hash changes", async () => {
    const cert = await makeCertificate();
    const first = cert.turns[0]!;
    const flipped = first.transcript_hash[0] === "a" ? "b" : "a";
    const tampered = {
      ...cert,
      turns: [{ ...first, transcript_hash: flipped + first.transcript_hash.slice(1) }, ...cert.turns.slice(1)],
    };
    const result = await verifyCertificate(tampered);
    expect(result.valid).toBe(false);
    expect(result.chainOk).toBe(false);
  });

  it("reports TAMPERED when the certificate body changes but the hash does not", async () => {
    const cert = await makeCertificate();
    const result = await verifyCertificate({ ...cert, created_at: "2026-09-07T09:00:00.000Z" });
    expect(result.valid).toBe(false);
    expect(result.hashOk).toBe(false);
    expect(result.chainOk).toBe(true);
  });

  it("reports TAMPERED when a turn is removed from the digest", async () => {
    const cert = await makeCertificate();
    const result = await verifyCertificate({ ...cert, turns: cert.turns.slice(0, 2) });
    expect(result.valid).toBe(false);
  });
});
