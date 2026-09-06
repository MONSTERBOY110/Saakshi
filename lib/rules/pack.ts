import { z } from "zod";

// Protocol packs: the human-readable rulebook Saakshi enforces (trd.md section 6.1).
// Patterns are regex sources matched case-insensitively with the Unicode flag against
// normalised text (see normalise.ts): lower case, punctuation turned into spaces, digits kept.

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const idPattern = /^[a-z][a-z0-9_]*$/;

export const CitationSchema = z.object({
  authority: z.string().min(1),
  instrument: z.string().min(1),
  clause: z.string().min(1),
  url: z.string().url().optional(),
});

export const CheckpointSchema = z.object({
  id: z.string().regex(idPattern),
  label: z.string().min(1),
  required_speaker: z.literal("advisor"),
  patterns: z.array(z.string().min(1)).min(1),
  citation: CitationSchema,
  hint: z.string().min(1),
  /** How the nudge names it, e.g. "the thirty day free look period". */
  spoken: z.string().min(1).optional(),
  teachback_topic: z.string().regex(idPattern).optional(),
});

export const SeveritySchema = z.enum(["critical", "high", "medium"]);

export const ProhibitedSchema = z.object({
  id: z.string().regex(idPattern),
  label: z.string().min(1),
  severity: SeveritySchema,
  patterns: z.array(z.string().min(1)).min(1),
  citation: CitationSchema,
  /** Patterns that show the advisor corrected this claim later (marks the violation corrected). */
  corrected_patterns: z.array(z.string().min(1)).optional(),
  /** Spoken by the agent. At most 20 words, no markdown, no exclamation marks. */
  correction: z
    .string()
    .min(1)
    .refine((s) => wordCount(s) <= 20, "correction must be 20 words or fewer")
    .refine((s) => !/[!*_#`]/.test(s), "correction must not contain markdown or exclamation marks"),
});

export const TeachbackTopicSchema = z.object({
  id: z.string().regex(idPattern),
  label: z.string().min(1),
  expected_points: z.array(z.string().min(1)).min(1),
  hint_hi: z.string().optional(),
});

export const DemoLineSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  text_en: z.string().min(1),
  text_display: z.string().min(1),
  wait_for: z.string().regex(/^(customer_turn|click|ms:\d+)$/),
});

const uniqueIds = <T extends { id: string }>(items: T[]) =>
  new Set(items.map((i) => i.id)).size === items.length;

export const PackSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: z.string().min(1),
  jurisdiction: z.enum(["IN", "UK"]),
  keyterms: z.array(z.string().min(1).max(50)).max(100),
  scenario_prompt: z.string().min(1).max(1750),
  checkpoints: z.array(CheckpointSchema).min(1).refine(uniqueIds, "duplicate checkpoint id"),
  prohibited: z.array(ProhibitedSchema).refine(uniqueIds, "duplicate prohibited id"),
  teachback_topics: z.array(TeachbackTopicSchema).refine(uniqueIds, "duplicate topic id"),
  demo_script: z.array(DemoLineSchema).refine(uniqueIds, "duplicate demo line id"),
});

export type Pack = z.infer<typeof PackSchema>;
export type Checkpoint = z.infer<typeof CheckpointSchema>;
export type Prohibited = z.infer<typeof ProhibitedSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type TeachbackTopic = z.infer<typeof TeachbackTopicSchema>;
export type DemoLine = z.infer<typeof DemoLineSchema>;

export type CompiledCheckpoint = Checkpoint & { regexes: RegExp[] };
export type CompiledProhibited = Prohibited & { regexes: RegExp[]; correctedRegexes: RegExp[] };
export type CompiledPack = Omit<Pack, "checkpoints" | "prohibited"> & {
  checkpoints: CompiledCheckpoint[];
  prohibited: CompiledProhibited[];
};

/** Compile every pattern once. Throws with the item id when a pattern is not a valid regex. */
export function compilePack(pack: Pack): CompiledPack {
  const compile = (kind: string, id: string, patterns: string[]) =>
    patterns.map((p) => {
      try {
        // NFC on the pattern too: Devanagari letters with nukta decompose under NFC, and the
        // engine normalises the transcript the same way, so both sides must agree.
        return new RegExp(p.normalize("NFC"), "giu");
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`${kind} ${id}: invalid pattern ${JSON.stringify(p)}: ${reason}`);
      }
    });
  return {
    ...pack,
    checkpoints: pack.checkpoints.map((c) => ({
      ...c,
      regexes: compile("checkpoint", c.id, c.patterns),
    })),
    prohibited: pack.prohibited.map((p) => ({
      ...p,
      regexes: compile("prohibited", p.id, p.patterns),
      correctedRegexes: compile("prohibited", p.id, p.corrected_patterns ?? []),
    })),
  };
}
