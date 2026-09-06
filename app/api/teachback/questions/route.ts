import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzerModels, gatewayBaseUrl } from "@/lib/analyzer/config";
import { structuredGatewayCall } from "@/lib/analyzer/gateway";
import { buildQuestionsSystemPrompt, buildQuestionsUserContent } from "@/lib/prompts/teachback";
import { getPack } from "@/lib/rules/load";
import { rateLimit } from "@/lib/server/rate-limit";
import {
  fallbackQuestions,
  mergeQuestions,
  prioritiseTopics,
  QUESTIONS_JSON_SCHEMA,
  QUESTIONS_SHAPE_HINT,
  QuestionsSchema,
  type TeachbackQuestion,
} from "@/lib/teachback/questions";
import type { BoardState } from "@/lib/session/board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One call per session, so it fits inside the account's gateway budget. If the gateway is
// unavailable or answers with anything unusable, the pack's own questions are returned instead:
// the teach-back must never stall in front of a customer.
const QUESTIONS_TIMEOUT_MS = Number(process.env.LLM_QUESTIONS_TIMEOUT_MS ?? 12_000);
const QUESTIONS_MAX_TOKENS = 700;

const RequestSchema = z.object({
  pack_id: z.string().min(1),
  context: z.object({ advisor: z.string(), customer: z.string(), product: z.string() }),
  board: z.object({
    checkpoints: z.array(
      z.object({ id: z.string(), status: z.enum(["pending", "met", "met_after_nudge"]) }),
    ),
    violations: z.array(z.object({ id: z.string(), label: z.string() })),
  }),
  advisor_digest: z.string().max(6000),
});

export type QuestionsResponse = {
  questions: TeachbackQuestion[];
  source: "llm" | "pack" | "mixed";
  model?: string;
  latency_ms?: number;
};

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`questions:${ip}`, 20)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  let pack;
  try {
    pack = getPack(body.data.pack_id);
  } catch {
    return NextResponse.json({ error: "unknown_pack" }, { status: 400 });
  }

  // Only the parts of the board the question generator needs.
  const board = {
    checkpoints: body.data.board.checkpoints,
    violations: body.data.board.violations,
  } as unknown as BoardState;
  const ctx = { pack, board, spokenText: body.data.advisor_digest };
  const apiKey = process.env.ASSEMBLYAI_API_KEY;

  if (apiKey) {
    const out = await structuredGatewayCall(
      {
        apiKey,
        baseUrl: gatewayBaseUrl(),
        models: analyzerModels(),
        timeoutMs: QUESTIONS_TIMEOUT_MS,
      },
      {
        system: buildQuestionsSystemPrompt(pack, prioritiseTopics(pack, board)),
        user: buildQuestionsUserContent({
          ...body.data.context,
          flagged: body.data.board.violations.map((v) => v.label),
          missing: body.data.board.checkpoints
            .filter((c) => c.status === "pending")
            .map((c) => c.id),
          advisorDigest: body.data.advisor_digest,
        }),
        schemaName: "saakshi_teachback_questions",
        jsonSchema: QUESTIONS_JSON_SCHEMA as unknown as Record<string, unknown>,
        shapeHint: QUESTIONS_SHAPE_HINT,
        parse: QuestionsSchema,
        maxTokens: QUESTIONS_MAX_TOKENS,
      },
    );
    if (out.ok) {
      const questions = mergeQuestions(out.data.questions, ctx);
      const sources = new Set(questions.map((q) => q.source));
      const response: QuestionsResponse = {
        questions,
        source: sources.size === 1 ? [...sources][0]! : "mixed",
        model: out.model,
        latency_ms: out.latencyMs,
      };
      return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
    }
    console.error("[teachback/questions]", out.error);
  }

  const response: QuestionsResponse = { questions: fallbackQuestions(pack, board), source: "pack" };
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
