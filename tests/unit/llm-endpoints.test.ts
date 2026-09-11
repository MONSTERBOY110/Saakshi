import { describe, expect, it } from "vitest";
import {
  assemblyaiEndpoints,
  llmEndpoints,
  PROVIDER_BASE_URL_DEFAULT,
  PROVIDER_MODELS_DEFAULT,
  providerEndpoints,
  structuredModeFor,
} from "@/lib/analyzer/config";

// The LLM endpoint list (docs/decisions.md, 2026-09-11): an OpenAI-compatible provider first when a
// key is set, the AssemblyAI LLM Gateway always last. AssemblyAI stays the voice stack either way.

const base = { ASSEMBLYAI_API_KEY: "aai-key" };

describe("llmEndpoints", () => {
  it("is the AssemblyAI gateway alone when no provider key is set", () => {
    const eps = llmEndpoints("analyzer", { ...base, LLM_ANALYZER_MODELS: "a,b" });
    expect(eps.map((e) => e.id)).toEqual(["assemblyai:a", "assemblyai:b"]);
    expect(eps[0]).toMatchObject({
      provider: "assemblyai",
      auth: "bare",
      structured: "json_schema",
      baseUrl: "https://llm-gateway.assemblyai.com/v1",
    });
    expect(eps[0]?.extras).toMatchObject({ post_processing_steps: [{ type: "json-repair" }] });
  });

  it("puts Groq first with Bearer auth and the gateway last when LLM_PROVIDER_API_KEY is set", () => {
    const eps = llmEndpoints("questions", {
      ...base,
      LLM_PROVIDER_API_KEY: "gsk_test",
      LLM_ANALYZER_MODELS: "qwen3.5-4b-32k-fast",
    });
    expect(eps.map((e) => e.id)).toEqual([
      "groq:openai/gpt-oss-120b",
      "groq:openai/gpt-oss-20b",
      "assemblyai:qwen3.5-4b-32k-fast",
    ]);
    expect(eps[0]).toMatchObject({
      provider: "groq",
      baseUrl: PROVIDER_BASE_URL_DEFAULT,
      apiKey: "gsk_test",
      auth: "bearer",
      structured: "json_schema",
      // gpt-oss reasons first: keep it short, keep it out of the reply, and leave room for the JSON.
      extras: { reasoning_effort: "low", include_reasoning: false },
      minCompletionTokens: 2048,
    });
    expect(eps[1]?.structured).toBe("json_schema");
    expect(eps[2]?.auth).toBe("bare");
    expect(eps[2]?.minCompletionTokens).toBeUndefined();
  });

  it("gives json_object mode and no reasoning extras to a model that does not enforce schemas", () => {
    const eps = providerEndpoints({
      LLM_PROVIDER_API_KEY: "gsk_test",
      LLM_PROVIDER_MODELS: "llama-3.3-70b-versatile",
    });
    expect(eps[0]).toMatchObject({ structured: "json_object" });
    expect(eps[0]?.extras).toBeUndefined();
    expect(eps[0]?.minCompletionTokens).toBeUndefined();
  });

  it("respects explicit provider base URL, models, name and structured mode, trimming slashes", () => {
    const eps = providerEndpoints({
      LLM_PROVIDER_API_KEY: "nvapi-1",
      LLM_PROVIDER_BASE_URL: "https://integrate.api.nvidia.com/v1/",
      LLM_PROVIDER_MODELS: " meta/llama-3.3-70b-instruct , ",
      LLM_PROVIDER_STRUCTURED: "prompt",
    });
    expect(eps).toHaveLength(1);
    expect(eps[0]).toMatchObject({
      id: "nvidia:meta/llama-3.3-70b-instruct",
      provider: "nvidia",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      structured: "prompt",
    });
    expect(providerEndpoints({ LLM_PROVIDER_API_KEY: "k", LLM_PROVIDER_NAME: "mine" })[0]?.id).toBe(
      `mine:${PROVIDER_MODELS_DEFAULT[0]}`,
    );
  });

  it("returns nothing at all when neither key is present", () => {
    expect(llmEndpoints("analyzer", {})).toEqual([]);
    expect(assemblyaiEndpoints({})).toEqual([]);
    expect(providerEndpoints({ LLM_PROVIDER_API_KEY: "   " })).toEqual([]);
  });

  it("maps models to the JSON mode Groq actually supports", () => {
    expect(structuredModeFor("openai/gpt-oss-120b")).toBe("json_schema");
    expect(structuredModeFor("openai/gpt-oss-20b")).toBe("json_schema");
    expect(structuredModeFor("qwen/qwen3.8-27b")).toBe("json_schema");
    expect(structuredModeFor("llama-3.3-70b-versatile")).toBe("json_object");
    expect(structuredModeFor("llama-3.3-70b-versatile", "json_schema")).toBe("json_schema");
    expect(structuredModeFor("anything", "nonsense")).toBe("json_object");
  });
});
