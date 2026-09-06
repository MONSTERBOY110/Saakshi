import type { CompiledPack } from "@/lib/rules/pack";
import type { BoardState } from "@/lib/session/board";
import type { SessionSetup } from "@/lib/session/keyterms";
import type { TeachbackAnswer } from "@/lib/session/store";
import type { StoredTurn } from "@/lib/session/transcript";
import { buildTurnDigest, certificateHash, chainHead, type ChainTurn } from "./chain";
import type { Certificate, CertificateDraft, Evidence } from "./schema";

// Turns the finished room into the Consent Certificate (trd.md section 7). Quotes, timestamps,
// citations and hashes only: the turn digest carries sha256(transcript), never the words, and no
// audio exists anywhere to carry.

export type CertificateSource = {
  pack: CompiledPack;
  board: BoardState;
  turns: StoredTurn[];
  answers: TeachbackAnswer[];
  setup: SessionSetup;
  session: {
    startedAt: string;
    endedAt: string;
    sttSessionId: string;
    agentSessionId: string;
    gaps: Array<{ from: string; to: string; reason?: string }>;
  };
  interventions: Array<{
    key: string;
    spokenText: string;
    latencyMs?: number;
    acknowledged: boolean;
  }>;
  demo: boolean;
};

export async function buildCertificateDraft(src: CertificateSource): Promise<CertificateDraft> {
  const evidenceTurns = src.turns
    .filter((t) => t.final && !t.echo && t.role)
    .sort((a, b) => a.order - b.order);
  const chainTurns: ChainTurn[] = evidenceTurns.map((t) => ({
    order: t.order,
    role: t.role as "advisor" | "customer",
    transcript: t.text,
    startMs: t.startMs,
    endMs: t.endMs,
  }));
  const digest = await buildTurnDigest(chainTurns);
  const head = await chainHead(
    {
      packId: src.pack.id,
      packVersion: src.pack.version,
      sttSessionId: src.session.sttSessionId,
    },
    digest,
  );
  const spoken = new Map(src.interventions.map((i) => [i.key, i]));

  return {
    version: "1.0",
    pack: { id: src.pack.id, version: src.pack.version, jurisdiction: src.pack.jurisdiction },
    parties: { advisor: src.setup.advisorName, customer: src.setup.customerName },
    product: {
      name: src.setup.productName,
      ...(src.setup.productTerms.length > 0 ? { terms: src.setup.productTerms } : {}),
    },
    session: {
      started_at: src.session.startedAt,
      ended_at: src.session.endedAt,
      stt_session_id: src.session.sttSessionId,
      agent_session_id: src.session.agentSessionId,
      gaps: src.session.gaps,
    },
    checkpoints: src.board.checkpoints.map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status === "pending" ? ("missing" as const) : c.status,
      ...(c.evidence ? { evidence: toEvidence(c.evidence) } : {}),
      citation: c.citation,
    })),
    violations: src.board.violations.map((v) => {
      const intervention = spoken.get(v.key);
      return {
        id: v.id,
        label: v.label,
        severity: v.severity,
        evidence: toEvidence(v.evidence),
        citation: v.citation,
        ...(intervention
          ? {
              intervention: {
                spoken_text: intervention.spokenText,
                ...(intervention.latencyMs !== undefined
                  ? { latency_ms: intervention.latencyMs }
                  : {}),
                acknowledged: v.status === "acknowledged" || intervention.acknowledged,
              },
            }
          : {}),
        resolution:
          v.status === "corrected"
            ? ("corrected" as const)
            : v.status === "acknowledged"
              ? ("acknowledged" as const)
              : ("unresolved" as const),
      };
    }),
    teachback: src.answers.map((a) => ({
      question_id: a.questionId,
      question: a.question,
      topic: a.topic,
      verdict: a.verdict,
      customer_quote: a.customerQuote,
      ...(a.evidence ? { evidence: a.evidence } : {}),
      reexplained: a.reexplained,
    })),
    turns: digest,
    turns_digest: { count: digest.length, chain_head: head },
    language_mix: languageMix(evidenceTurns),
    demo: src.demo,
    created_at: new Date().toISOString(),
  };
}

/** Attach the id and the hash. The server does this so the hash is never client-supplied. */
export async function finaliseCertificate(
  draft: CertificateDraft,
  id: string,
): Promise<Certificate> {
  const base = { ...draft, id, certificate_hash: "" };
  return { ...base, certificate_hash: await certificateHash(base) };
}

function toEvidence(e: {
  turnOrder: number;
  role: "advisor" | "customer";
  startMs: number;
  endMs: number;
  quote: string;
  language: string;
}): Evidence {
  return {
    turn_order: e.turnOrder,
    speaker_role: e.role,
    start_ms: e.startMs,
    end_ms: e.endMs,
    quote: e.quote,
    language: e.language,
  };
}

function languageMix(turns: StoredTurn[]): string {
  const tags = new Set(turns.map((t) => t.language));
  if (tags.has("hi+en") || (tags.has("hi") && tags.has("en"))) return "mixed";
  if (tags.has("hi")) return "hi";
  return "en";
}
