import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { structuredGatewayCall } from "@/lib/analyzer/gateway";
import { buildQuestionsSystemPrompt, buildQuestionsUserContent } from "@/lib/prompts/teachback";
import { getPack } from "@/lib/rules/load";
import { rebuildBoard } from "@/lib/session/board";
import type { StoredTurn } from "@/lib/session/transcript";
import {
  isLeadingQuestion,
  MAX_QUESTION_WORDS,
  mergeQuestions,
  prioritiseTopics,
  QUESTIONS_JSON_SCHEMA,
  QUESTIONS_SHAPE_HINT,
  QuestionsSchema,
  validateQuestion,
} from "@/lib/teachback/questions";
import { apiKeyFromEnv } from "../helpers/api-key";

// One live question-generation call, judged by the same rules the route applies before speaking.
// Run: SAAKSHI_LIVE_EVAL=1 pnpm exec vitest run tests/unit/questions-live.test.ts
// Costs one gateway call, which is the whole budget a real session spends on questions.
const live = !!process.env.SAAKSHI_LIVE_EVAL;

type Dialogue = { id: string; turns: Array<{ role: "advisor" | "customer"; text: string }> };
type Fixture = {
  context: { advisor: string; customer: string; product: string };
  dialogues: Dialogue[];
};

// A pitch that discloses some things, hides the free look, and makes two prohibited claims.
const SCENE = ["clean_pitch", "lockin_and_charges", "guaranteed_english", "withdraw_anytime"];

function sceneTurns(fixture: Fixture): StoredTurn[] {
  const picked = SCENE.flatMap((id) => fixture.dialogues.find((d) => d.id === id)?.turns ?? []);
  return picked.map((t, i) => ({
    order: i,
    text: t.text,
    final: true,
    formatted: true,
    speakerLabel: t.role === "advisor" ? "A" : "B",
    role: t.role,
    language: "en",
    startMs: i * 3000,
    endMs: i * 3000 + 2500,
    words: [],
    revised: false,
    pending: false,
  }));
}

describe.skipIf(!live)("teach-back question generation, live (SAAKSHI_LIVE_EVAL)", () => {
  it("returns speakable questions that invent nothing", async () => {
    const key = apiKeyFromEnv();
    expect(key, "ASSEMBLYAI_API_KEY").not.toBe("");
    const pack = getPack("insurance-ulip-in");
    const fixture = JSON.parse(
      readFileSync(join(process.cwd(), "tests", "fixtures", "analyzer", "dialogues.json"), "utf8"),
    ) as Fixture;
    const turns = sceneTurns(fixture);
    const board = rebuildBoard(pack, turns);
    const advisorDigest = turns
      .filter((t) => t.role === "advisor")
      .map((t) => t.text)
      .join(" ");
    const ctx = { pack, board, spokenText: advisorDigest };

    const out = await structuredGatewayCall(
      {
        apiKey: key,
        baseUrl: process.env.LLM_GATEWAY_BASE_URL ?? "https://llm-gateway.assemblyai.com/v1",
        models: (
          process.env.LLM_ANALYZER_MODELS ??
          "gemini-3.5-flash-lite,claude-haiku-4-5-20251001,qwen3.5-4b-32k-fast"
        )
          .split(",")
          .map((m) => m.trim()),
        timeoutMs: 20_000,
      },
      {
        system: buildQuestionsSystemPrompt(pack, prioritiseTopics(pack, board)),
        user: buildQuestionsUserContent({
          ...fixture.context,
          flagged: board.violations.map((v) => v.label),
          missing: board.checkpoints.filter((c) => c.status === "pending").map((c) => c.id),
          advisorDigest,
        }),
        schemaName: "saakshi_teachback_questions",
        jsonSchema: QUESTIONS_JSON_SCHEMA as unknown as Record<string, unknown>,
        shapeHint: QUESTIONS_SHAPE_HINT,
        parse: QuestionsSchema,
        maxTokens: 700,
      },
    );

    const report = {
      ran_at: new Date().toISOString(),
      scene: SCENE,
      flagged: board.violations.map((v) => v.id),
      not_disclosed: board.checkpoints.filter((c) => c.status === "pending").map((c) => c.id),
      ok: out.ok,
      model: out.ok ? out.model : undefined,
      latency_ms: out.ok ? out.latencyMs : undefined,
      structured_output: out.ok ? out.structured : undefined,
      error: out.ok ? undefined : out.error,
      raw: out.ok ? out.data.questions : [],
      kept: out.ok ? mergeQuestions(out.data.questions, ctx) : [],
      rejected: out.ok
        ? out.data.questions.filter((q) => !validateQuestion(q, ctx)).map((q) => q.question_en)
        : [],
    };
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/questions-eval.json", JSON.stringify(report, null, 2));
    console.log(`\n[questions-eval] ${JSON.stringify(report, null, 2)}`);

    // A gateway the account cannot reach is a known, recorded limitation, not a question-quality
    // failure: the route falls back to the pack. Only judge quality when a model actually answered.
    if (!out.ok) {
      expect(out.error, "gateway unreachable; see docs/decisions.md").toMatch(
        /HTTP 429|does not have access|timeout|HTTP 5\d\d/,
      );
      return;
    }
    const questions = report.kept;
    expect(questions.length).toBeGreaterThanOrEqual(3);
    expect(new Set(questions.map((q) => q.topic)).size).toBe(questions.length);
    for (const q of questions) {
      expect(q.question.split(/\s+/).length).toBeLessThanOrEqual(MAX_QUESTION_WORDS);
      expect(q.question).not.toMatch(/[!*_#`]/);
      expect(q.question.trim().endsWith("?"), q.question).toBe(true);
      expect(isLeadingQuestion(q.question), q.question).toBe(false);
    }
    // If the prompt were poor, every question would silently fall back to the pack and the demo
    // would look fine while the model contributed nothing. Most kept questions must be generated.
    const fromModel = questions.filter((q) => q.source === "llm").length;
    expect(
      fromModel,
      `only ${fromModel} of ${questions.length} came from the model`,
    ).toBeGreaterThanOrEqual(3);
    // The point of the phase: ask about what went wrong and what was never said.
    const topics = new Set(questions.map((q) => q.topic));
    expect(topics.has("market_risk") || topics.has("lock_in")).toBe(true);
  }, 120_000);
});
