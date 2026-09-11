import { buildAnalyzerSystemPrompt, buildAnalyzerUserContent } from "@/lib/prompts/analyzer";
import type { CompiledPack } from "@/lib/rules/pack";
import type { z } from "zod";
import { ASSEMBLYAI_EXTRAS, type LlmEndpoint, type StructuredMode } from "./config";
import {
  ANALYSIS_JSON_SCHEMA,
  AnalysisSchema,
  sanitizeAnalysis,
  type Analysis,
  type AnalyzeRequest,
} from "./schema";

// One JSON object from the first endpoint that can produce it (docs/decisions.md, 2026-09-11).
//
// Endpoints are OpenAI-compatible chat-completions hosts: POST {baseUrl}/chat/completions, content
// at choices[0].message.content. They differ in three ways this file handles: the auth header
// (Groq wants Bearer, the AssemblyAI gateway takes the bare key), provider-only request fields
// (the gateway's json-repair post-processing), and how JSON is requested. A model that enforces a
// schema gets response_format json_schema; one that only promises valid JSON gets json_object mode
// with the shape described in the prompt; one that does neither gets the description alone.
//
// Capabilities are learned once per endpoint and remembered: a model the account cannot use is
// dropped from later attempts, and a model that refuses response_format is asked in prose instead.

export type GatewayDeps = {
  /** Tried in order; the first usable endpoint wins. */
  endpoints?: LlmEndpoint[];
  /** Legacy shape: one AssemblyAI gateway with several models. */
  apiKey?: string;
  baseUrl?: string;
  models?: string[];
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type StructuredRequest<T> = {
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  /** Shape description used when the model has no schema enforcement. */
  shapeHint: string;
  parse: z.ZodType<T>;
  maxTokens: number;
};

export type StructuredOutcome<T> =
  | {
      ok: true;
      data: T;
      model: string;
      provider: string;
      endpoint: string;
      latencyMs: number;
      requestId?: string;
      /** True when the server enforced the JSON schema (json_schema mode). */
      structured: boolean;
      mode: StructuredMode;
    }
  | { ok: false; error: string; latencyMs: number };

type EndpointState = { noAccess?: boolean; schemaRefused?: boolean };
const endpointState = new Map<string, EndpointState>();
const stateKey = (ep: LlmEndpoint) => `${ep.baseUrl}|${ep.model}`;

/** Test seam: forget what was learned about each endpoint. */
export function resetModelCapabilities(): void {
  endpointState.clear();
}

/** Legacy `{ apiKey, baseUrl, models }` becomes AssemblyAI gateway endpoints. */
export function endpointsOf(deps: GatewayDeps): LlmEndpoint[] {
  if (deps.endpoints && deps.endpoints.length > 0) return deps.endpoints;
  if (!deps.apiKey || !deps.baseUrl || !deps.models) return [];
  return deps.models.map((model) => ({
    id: `assemblyai:${model}`,
    provider: "assemblyai",
    baseUrl: deps.baseUrl!.replace(/\/+$/, ""),
    apiKey: deps.apiKey!,
    model,
    auth: "bare" as const,
    structured: "json_schema" as const,
    extras: ASSEMBLYAI_EXTRAS,
  }));
}

/** Ask for one JSON object, trying each endpoint until one answers usefully. */
export async function structuredGatewayCall<T>(
  deps: GatewayDeps,
  req: StructuredRequest<T>,
): Promise<StructuredOutcome<T>> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const errors: string[] = [];
  const endpoints = endpointsOf(deps);
  if (endpoints.length === 0) {
    return { ok: false, error: "no LLM endpoint configured", latencyMs: now() - started };
  }

  for (const ep of endpoints) {
    const state = endpointState.get(stateKey(ep)) ?? {};
    if (state.noAccess) continue;
    for (const mode of modesFor(ep, state)) {
      try {
        const { content, requestId } = await callOnce(deps, ep, req, mode);
        const parsed = req.parse.safeParse(parseJsonObject(content));
        if (!parsed.success) {
          errors.push(`${ep.id}: schema: ${parsed.error.issues[0]?.message ?? "invalid"}`);
          break; // next endpoint
        }
        return {
          ok: true,
          data: parsed.data,
          model: ep.model,
          provider: ep.provider,
          endpoint: ep.id,
          latencyMs: now() - started,
          requestId,
          structured: mode === "json_schema",
          mode,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${ep.id}: ${message}`);
        if (mode === "json_schema" && refusesSchema(message)) {
          endpointState.set(stateKey(ep), { ...state, schemaRefused: true });
          continue; // same endpoint, shape described in the prompt, from now on
        }
        if (mode === "json_schema" && failedValidation(message)) {
          continue; // same endpoint, shape described in the prompt, this call only
        }
        if (noAccess(message)) endpointState.set(stateKey(ep), { ...state, noAccess: true });
        break; // next endpoint
      }
    }
  }
  return { ok: false, error: errors.join(" | "), latencyMs: now() - started };
}

/** json_schema endpoints fall back to prose once the model has refused a schema. */
function modesFor(ep: LlmEndpoint, state: EndpointState): StructuredMode[] {
  if (ep.structured === "json_schema")
    return state.schemaRefused ? ["prompt"] : ["json_schema", "prompt"];
  return [ep.structured];
}

function refusesSchema(message: string): boolean {
  return /does not support response_format|response_format|json_schema|structured output/i.test(
    message,
  );
}

/** The model produced something that did not match the schema (Groq strict mode reports a 400). */
function failedValidation(message: string): boolean {
  return /failed to validate json|failed_generation|does not match (the )?schema/i.test(message);
}

function noAccess(message: string): boolean {
  return /does not have access|model_not_found|does not exist|not found|decommissioned|HTTP 401|HTTP 403/i.test(
    message,
  );
}

export const ANALYZER_MAX_TOKENS = 600;

export type GatewayOutcome =
  | {
      ok: true;
      analysis: Analysis;
      model: string;
      provider: string;
      endpoint: string;
      latencyMs: number;
      requestId?: string;
      structured: boolean;
      mode: StructuredMode;
    }
  | { ok: false; error: string; latencyMs: number };

/** Layer 2 of the analyzer (trd.md section 6.2). Advisory since 2026-09-09. */
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
    provider: out.provider,
    endpoint: out.endpoint,
    latencyMs: out.latencyMs,
    requestId: out.requestId,
    structured: out.structured,
    mode: out.mode,
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
  ep: LlmEndpoint,
  req: StructuredRequest<T>,
  mode: StructuredMode,
): Promise<{ content: string; requestId?: string }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  const system =
    mode === "json_schema" ? req.system : `${req.system}\n\n${shapeInstruction(req.shapeHint)}`;
  const body: Record<string, unknown> = {
    model: ep.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: req.user },
    ],
    max_tokens: Math.max(req.maxTokens, ep.minCompletionTokens ?? 0),
    temperature: 0,
    ...(ep.extras ?? {}),
  };
  if (mode === "json_schema") {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: req.schemaName, strict: true, schema: req.jsonSchema },
    };
  } else if (mode === "json_object") {
    body.response_format = { type: "json_object" };
  }
  try {
    const res = await fetchImpl(`${ep.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: ep.auth === "bearer" ? `Bearer ${ep.apiKey}` : ep.apiKey,
        "content-type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as {
      id?: string;
      request_id?: string;
      message?: string;
      error?:
        { message?: string; code?: string; type?: string; failed_generation?: string } | string;
      metadata?: { errors?: string[] };
      choices?: Array<{ message?: { content?: string | null } }>;
    } | null;
    if (!res.ok) {
      const providerError =
        typeof json?.error === "string" ? json.error : (json?.error?.message ?? undefined);
      // Groq returns the text that failed its schema check; the first line says why.
      const failed =
        typeof json?.error === "object" && json.error?.failed_generation
          ? ` (generation: ${json.error.failed_generation.replace(/\s+/g, " ").slice(0, 160)})`
          : "";
      const detail =
        json?.metadata?.errors?.join("; ") ?? `${providerError ?? json?.message ?? ""}${failed}`;
      throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content) throw new Error("empty content");
    return { content, requestId: json?.request_id ?? json?.id };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`timeout after ${deps.timeoutMs} ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** For models without schema enforcement: describe the shape and demand bare JSON. */
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
