import type { AnalyzeRequest } from "@/lib/analyzer/schema";
import type { CompiledPack } from "@/lib/rules/pack";

// Prompts are code (CLAUDE.md). Version bumps go here; changes are evaluated with the golden
// dialogues in tests/fixtures/analyzer/dialogues.json (live eval: SAAKSHI_LIVE_EVAL=1).
export const ANALYZER_PROMPT_VERSION = "2026-09-06.1";

export function buildAnalyzerSystemPrompt(pack: CompiledPack): string {
  const checkpoints = pack.checkpoints.map((c) => `- ${c.id}: ${c.label}. ${c.hint}`).join("\n");
  const prohibited = pack.prohibited
    .map((p) => `- ${p.id} (${p.severity}): ${p.label}. ${p.citation.clause}.`)
    .join("\n");
  return [
    "You audit a regulated sales conversation in India for a compliance witness called Saakshi.",
    `Product type: ${pack.title}. Jurisdiction: ${pack.jurisdiction}.`,
    "You receive the last few finalized turns as JSON with turn_order, role (advisor or customer) and text.",
    "Speech may be English, Hindi (Devanagari or Roman letters) or a mix; treat them as equivalent for meaning.",
    "",
    "Required disclosures (checkpoint ids). Report one only when the ADVISOR clearly made it:",
    checkpoints,
    "",
    "Prohibited claims (violation ids). Report one only when the ADVISOR clearly made the claim:",
    prohibited,
    "",
    "Rules:",
    "- Use only ids from the two lists above. Never invent an id.",
    "- quote must be copied verbatim from the turn text you cite; never paraphrase.",
    "- turn_order must be the turn you quote from, and it must be an advisor turn for checkpoints and violations.",
    "- A negated statement is not a violation: 'returns are not guaranteed' satisfies nothing and violates nothing.",
    "- A customer repeating or asking about a claim is not an advisor violation.",
    "- Do not infer facts that are not in the text. If unsure, keep the item but lower confidence rather than omit it.",
    "- customer_questions_unanswered: customer questions that no later advisor turn in the window answered.",
    "- language_mix: en, hi, or mixed for the window as a whole.",
    "Return only the JSON object.",
  ].join("\n");
}

export function buildAnalyzerUserContent(req: AnalyzeRequest): string {
  return JSON.stringify(
    {
      participants: { advisor: req.context.advisor, customer: req.context.customer },
      product: req.context.product,
      turns: req.turns.map((t) => ({ turn_order: t.order, role: t.role, text: t.text })),
    },
    null,
    0,
  );
}
