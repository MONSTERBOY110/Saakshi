import { buildAnalyzerSystemPrompt, buildAnalyzerUserContent } from "@/lib/prompts/analyzer";
import type { CompiledPack } from "@/lib/rules/pack";
import type { z } from "zod";
import {
  ANALYSIS_JSON_SCHEMA,
  AnalysisSchema,
  sanitizeAnalysis,
  type Analysis,
  type AnalyzeRequest,
} from "./schema";

// Calls to the AssemblyAI LLM Gateway (verified from the docs and the live API on 2026-09-06):
// POST {baseUrl}/chat/completions, header "authorization: <api key>" (no Bearer), content at
// choices[0].message.content, json-repair post-processing on every model.
//
// Model access and structured-output support vary by account, and the gateway reports both as a
// 400 with a message in metadata.errors. The client learns each model's capability once and then
// skips what does not work: a model without response_format gets the shape described in the prompt
// instead, and a model the account cannot use is dropped from later attempts.

export type GatewayDeps = {
  apiKey: string;
  baseUrl: string;
  /** Tried in order; the first usable model wins. */
  models: string[];
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type StructuredRequest<T> = {
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  /** Shape description used when the model has no structured-output support. */
  shapeHint: string;
  parse: z.ZodType<T>;
  maxTokens: number;
};

export type StructuredOutcome<T> =
  | { ok: true; data: T; model: string; latencyMs: number; requestId?: string; structured: boolean }
  | { ok: false; error: string; latencyMs: number };

type ModelState = { noAccess?: boolean; responseFormat?: boolean };
const modelState = new Map<string, ModelState>();

/** Test seam: forget what was learned about each model. */
export function resetModelCapabilities(): void {
  modelState.clear();
}

/** Ask the gateway for one JSON object, trying each model until one answers usefully. */
export async function structuredGatewayCall<T>(
  deps: GatewayDeps,
  req: StructuredRequest<T>,
): Promise<StructuredOutcome<T>> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const errors: string[] = [];

  for (const model of deps.models) {
    const state = modelState.get(model) ?? {};
    if (state.noAccess) continue;
    for (const structured of state.responseFormat === false ? [false] : [true, false]) {
      try {
        const { content, requestId } = await callOnce(deps, model, req, structured);
        modelState.set(model, { ...state, responseFormat: structured });
        const parsed = req.parse.safeParse(parseJsonObject(content));
        if (!parsed.success) {
          errors.push(`${model}: schema: ${parsed.error.issues[0]?.message ?? "invalid"}`);
          break;
        }
        return {
          ok: true,
          data: parsed.data,
          model,
          latencyMs: now() - started,
          requestId,
          structured,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${model}: ${message}`);
        if (/does not support response_format/i.test(message)) {
          modelState.set(model, { ...state, responseFormat: false });
          continue; // same model, shape described in the prompt
        }
        if (/does not have access/i.test(message)) {
          modelState.set(model, { ...state, noAccess: true });
        }
        break; // next model
      }
    }
  }
  return { ok: false, error: errors.join(" | "), latencyMs: now() - started };
}

export const ANALYZER_MAX_TOKENS = 600;

export type GatewayOutcome =
  | {
      ok: true;
      analysis: Analysis;
      model: string;
      latencyMs: number;
      requestId?: string;
      structured: boolean;
    }
  | { ok: false; error: string; latencyMs: number };

/** Layer 2 of the analyzer (trd.md section 6.2). */
export async function analyzeWithGateway(
  deps: GatewayDeps,
  req: AnalyzeRequest,
  pack: CompiledPack,
): Promise<GatewayOutcome> {
  const out = await structuredGatewayCall(deps, {
    system: buildAnalyzerSystemPrompt(pack),
    user: buildAnalyzerUserContent(req),
    schemaName: "saakshi_analysis",
    jsonSchema: ANALYSIS_JSON_SCHEMA,
    shapeHint: ANALYSIS_SHAPE_HINT,
    parse: AnalysisSchema,
    maxTokens: ANALYZER_MAX_TOKENS,
  });
  if (!out.ok) return out;
  const orders = req.turns.map((t) => t.order);
  const advisorOrders = req.turns.filter((t) => t.role === "advisor").map((t) => t.order);
  return {
    ok: true,
    analysis: sanitizeAnalysis(out.data, pack, orders, advisorOrders),
    model: out.model,
    latencyMs: out.latencyMs,
    requestId: out.requestId,
    structured: out.structured,
  };
}

const ANALYSIS_SHAPE_HINT = JSON.stringify({
  checkpoints_satisfied: [{ id: "string", turn_order: 0, quote: "string", confidence: 0.0 }],
  violations: [
    {
      id: "string",
      turn_order: 0,
      quote: "string",
      severity: "critical|high|medium",
      confidence: 0.0,
      rationale: "string",
    },
  ],
  customer_questions_unanswered: [{ turn_order: 0, quote: "string", topic: "string" }],
  language_mix: "en|hi|mixed",
});

async function callOnce<T>(
  deps: GatewayDeps,
  model: string,
  req: StructuredRequest<T>,
  structured: boolean,
): Promise<{ content: string; requestId?: string }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  const system = structured ? req.system : `${req.system}\n\n${shapeInstruction(req.shapeHint)}`;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: req.user },
    ],
    max_tokens: req.maxTokens,
    temperature: 0,
    post_processing_steps: [{ type: "json-repair" }],
    fallback_config: { retry: false },
  };
  if (structured) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: req.schemaName, strict: true, schema: req.jsonSchema },
    };
  }
  try {
    const res = await fetchImpl(`${deps.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: deps.apiKey, "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as {
      request_id?: string;
      message?: string;
      metadata?: { errors?: string[] };
      choices?: Array<{ message?: { content?: string | null } }>;
    } | null;
    if (!res.ok) {
      const detail = json?.metadata?.errors?.join("; ") ?? json?.message ?? "";
      throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content) throw new Error("empty content");
    return { content, requestId: json?.request_id };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`timeout after ${deps.timeoutMs} ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** For models without structured outputs: describe the shape and demand bare JSON. */
function shapeInstruction(shape: string): string {
  return [
    "Return one JSON object and nothing else. No prose, no code fences.",
    "Shape:",
    shape,
    "Every key must be present; use an empty array when there is nothing to report.",
  ].join("\n");
}

/** Tolerate a code fence or stray prose around the object (prompt-only mode). */
function parseJsonObject(content: string): unknown {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("response was not JSON");
  }
}
