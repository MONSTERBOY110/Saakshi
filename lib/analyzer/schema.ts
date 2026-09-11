import { z } from "zod";
import type { CompiledPack } from "@/lib/rules/pack";

// Layer 2 of the analyzer (trd.md section 6.2): strict structured output from the LLM Gateway.
// The Zod schema validates what comes back; the JSON schema is what the gateway enforces
// (strict, additionalProperties false at every level, every key required).

const Confidence = z.number().min(0).max(1);

export const AnalysisSchema = z.object({
  checkpoints_satisfied: z.array(
    z.object({
      id: z.string(),
      turn_order: z.number().int(),
      quote: z.string(),
      confidence: Confidence,
    }),
  ),
  violations: z.array(
    z.object({
      id: z.string(),
      turn_order: z.number().int(),
      quote: z.string(),
      severity: z.enum(["critical", "high", "medium"]),
      confidence: Confidence,
      rationale: z.string(),
    }),
  ),
  customer_questions_unanswered: z.array(
    z.object({ turn_order: z.number().int(), quote: z.string(), topic: z.string() }),
  ),
  language_mix: z.enum(["en", "hi", "mixed"]),
});

export type Analysis = z.infer<typeof AnalysisSchema>;

const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

export const ANALYSIS_JSON_SCHEMA = obj({
  checkpoints_satisfied: {
    type: "array",
    items: obj({
      id: { type: "string", description: "A checkpoint id from the pack list, verbatim." },
      turn_order: {
        type: "integer",
        description: "turn_order of the advisor turn that satisfies it.",
      },
      quote: { type: "string", description: "Verbatim words from that turn." },
      confidence: { type: "number", description: "0 to 1." },
    }),
  },
  violations: {
    type: "array",
    items: obj({
      id: { type: "string", description: "A prohibited-claim id from the pack list, verbatim." },
      turn_order: { type: "integer", description: "turn_order of the advisor turn." },
      quote: { type: "string", description: "Verbatim words from that turn." },
      severity: { type: "string", enum: ["critical", "high", "medium"] },
      confidence: { type: "number", description: "0 to 1." },
      rationale: { type: "string", description: "One sentence, under 200 characters." },
    }),
  },
  customer_questions_unanswered: {
    type: "array",
    items: obj({
      turn_order: { type: "integer" },
      quote: { type: "string" },
      topic: { type: "string" },
    }),
  },
  language_mix: { type: "string", enum: ["en", "hi", "mixed"] },
});

export const AnalyzeRequestSchema = z.object({
  pack_id: z.string().min(1),
  turns: z
    .array(
      z.object({
        order: z.number().int(),
        role: z.enum(["advisor", "customer"]),
        text: z.string().min(1).max(2000),
        start_ms: z.number(),
      }),
    )
    .min(1)
    .max(8),
  context: z.object({ advisor: z.string(), customer: z.string(), product: z.string() }),
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export type AnalyzeResponse = {
  analysis: Analysis;
  model: string;
  /** Which host answered: groq, assemblyai, or another OpenAI-compatible provider. */
  provider?: string;
  latency_ms: number;
  request_id?: string;
};

/**
 * Keep only ids that exist in the pack and turns that were in the analysed window
 * (optionally only advisor turns for checkpoints and violations); clamp and trim.
 */
export function sanitizeAnalysis(
  a: Analysis,
  pack: CompiledPack,
  turnOrders: number[],
  advisorOrders?: number[],
): Analysis {
  const checkpointIds = new Set(pack.checkpoints.map((c) => c.id));
  const prohibitedIds = new Set(pack.prohibited.map((p) => p.id));
  const inWindow = new Set(turnOrders);
  const advisor = advisorOrders ? new Set(advisorOrders) : inWindow;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  return {
    checkpoints_satisfied: a.checkpoints_satisfied
      .filter((c) => checkpointIds.has(c.id) && advisor.has(c.turn_order))
      .map((c) => ({ ...c, confidence: clamp(c.confidence), quote: c.quote.slice(0, 240) })),
    violations: a.violations
      .filter((v) => prohibitedIds.has(v.id) && advisor.has(v.turn_order))
      .map((v) => ({
        ...v,
        confidence: clamp(v.confidence),
        quote: v.quote.slice(0, 240),
        rationale: v.rationale.slice(0, 200),
      })),
    customer_questions_unanswered: a.customer_questions_unanswered
      .filter((q) => inWindow.has(q.turn_order))
      .map((q) => ({ ...q, quote: q.quote.slice(0, 240) })),
    language_mix: a.language_mix,
  };
}
