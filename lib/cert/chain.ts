import { canonicalJson, sha256Hex } from "./canonical";

// The hash chain that makes a certificate re-verifiable without the transcript (prd.md FR-9):
//   h0 = sha256(pack_id | pack_version | stt_session_id)
//   hi = sha256(h(i-1) | turn_order | speaker_role | transcript_hash | start_ms | end_ms)
// Fields are joined with "|" as UTF-8; hashes are lower-case hex. Because each turn contributes
// only sha256(transcript), the stored certificate holds digests, never the words, and anyone can
// recompute the head from the certificate alone.

export type ChainSeed = { packId: string; packVersion: string; sttSessionId: string };

export type ChainTurn = {
  order: number;
  role: "advisor" | "customer";
  transcript: string;
  startMs: number;
  endMs: number;
};

/** What the certificate stores per turn: the hash of the words, never the words. */
export type DigestTurn = {
  turn_order: number;
  speaker_role: "advisor" | "customer";
  transcript_hash: string;
  start_ms: number;
  end_ms: number;
};

export async function buildTurnDigest(turns: ChainTurn[]): Promise<DigestTurn[]> {
  return Promise.all(
    turns.map(async (t) => ({
      turn_order: t.order,
      speaker_role: t.role,
      transcript_hash: await sha256Hex(t.transcript),
      start_ms: t.startMs,
      end_ms: t.endMs,
    })),
  );
}

/** Fold turns (or their digest) into the chain head, in the order given. */
export async function chainHead(
  seed: ChainSeed,
  turns: Array<ChainTurn | DigestTurn>,
): Promise<string> {
  let h = await sha256Hex(`${seed.packId}|${seed.packVersion}|${seed.sttSessionId}`);
  for (const turn of turns) {
    const d = isDigest(turn) ? turn : await digestOf(turn);
    h = await sha256Hex(
      `${h}|${d.turn_order}|${d.speaker_role}|${d.transcript_hash}|${d.start_ms}|${d.end_ms}`,
    );
  }
  return h;
}

/** sha256 of the canonical JSON of the certificate with certificate_hash emptied. */
export async function certificateHash(certificate: Record<string, unknown>): Promise<string> {
  return sha256Hex(canonicalJson({ ...certificate, certificate_hash: "" }));
}

export type VerifyResult = { valid: boolean; chainOk: boolean; hashOk: boolean };

/**
 * Recompute both proofs from the stored payload alone: the chain head over the turn digest, and
 * the certificate hash over everything else. Both must match for VALID.
 */
export async function verifyCertificate(certificate: {
  pack: { id: string; version: string };
  session: { stt_session_id: string };
  turns: DigestTurn[];
  turns_digest: { count: number; chain_head: string };
  certificate_hash: string;
  [key: string]: unknown;
}): Promise<VerifyResult> {
  const head = await chainHead(
    {
      packId: certificate.pack.id,
      packVersion: certificate.pack.version,
      sttSessionId: certificate.session.stt_session_id,
    },
    certificate.turns,
  );
  const chainOk =
    head === certificate.turns_digest.chain_head &&
    certificate.turns.length === certificate.turns_digest.count;
  const hashOk = (await certificateHash(certificate)) === certificate.certificate_hash;
  return { valid: chainOk && hashOk, chainOk, hashOk };
}

function isDigest(turn: ChainTurn | DigestTurn): turn is DigestTurn {
  return "transcript_hash" in turn;
}

async function digestOf(turn: ChainTurn): Promise<DigestTurn> {
  return {
    turn_order: turn.order,
    speaker_role: turn.role,
    transcript_hash: await sha256Hex(turn.transcript),
    start_ms: turn.startMs,
    end_ms: turn.endMs,
  };
}
