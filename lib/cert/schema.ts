import { z } from "zod";

// The Consent Certificate (trd.md section 7). It stores quotes, timestamps and hashes, never audio
// and never the full transcript: each turn contributes only sha256(transcript), so the chain stays
// re-verifiable while the conversation itself is not published.

export const EvidenceSchema = z.object({
  turn_order: z.number().int(),
  speaker_role: z.enum(["advisor", "customer"]),
  start_ms: z.number(),
  end_ms: z.number(),
  quote: z.string(),
  language: z.string(),
});

export const CitationSchema = z.object({
  authority: z.string(),
  instrument: z.string(),
  clause: z.string(),
  url: z.string().optional(),
});

export const DigestTurnSchema = z.object({
  turn_order: z.number().int(),
  speaker_role: z.enum(["advisor", "customer"]),
  transcript_hash: z.string().regex(/^[0-9a-f]{64}$/),
  start_ms: z.number(),
  end_ms: z.number(),
});

export const CertificateSchema = z.object({
  id: z.string().min(8),
  version: z.literal("1.0"),
  pack: z.object({ id: z.string(), version: z.string(), jurisdiction: z.string() }),
  parties: z.object({
    advisor: z.string(),
    customer: z.string(),
    organisation: z.string().optional(),
  }),
  product: z.object({ name: z.string(), terms: z.array(z.string()).optional() }),
  session: z.object({
    started_at: z.string(),
    ended_at: z.string(),
    stt_session_id: z.string(),
    agent_session_id: z.string(),
    gaps: z.array(z.object({ from: z.string(), to: z.string(), reason: z.string().optional() })),
  }),
  checkpoints: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.enum(["met", "missing", "met_after_nudge"]),
      evidence: EvidenceSchema.optional(),
      citation: CitationSchema,
    }),
  ),
  violations: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      severity: z.string(),
      evidence: EvidenceSchema,
      citation: CitationSchema,
      intervention: z
        .object({
          spoken_text: z.string(),
          latency_ms: z.number().optional(),
          acknowledged: z.boolean(),
        })
        .optional(),
      resolution: z.enum(["corrected", "acknowledged", "unresolved"]),
    }),
  ),
  teachback: z.array(
    z.object({
      question_id: z.string(),
      question: z.string(),
      topic: z.string(),
      verdict: z.enum(["understood", "partial", "not_understood"]),
      customer_quote: z.string(),
      evidence: EvidenceSchema.optional(),
      reexplained: z.boolean(),
    }),
  ),
  turns: z.array(DigestTurnSchema),
  turns_digest: z.object({
    count: z.number().int(),
    chain_head: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  language_mix: z.string(),
  demo: z.boolean(),
  created_at: z.string(),
  certificate_hash: z.string(),
});

export type Certificate = z.infer<typeof CertificateSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;

/** What the browser posts: everything except the id and the hash, which the server owns. */
export const CertificateDraftSchema = CertificateSchema.omit({ id: true, certificate_hash: true });
export type CertificateDraft = z.infer<typeof CertificateDraftSchema>;

export type StoreCertificateResponse = {
  id: string;
  certificate_hash: string;
  url: string;
  /** False when the record lives in memory, so the link only works on this server instance. */
  durable: boolean;
};
