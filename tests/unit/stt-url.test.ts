import { describe, expect, it } from "vitest";
import { buildSttUrl } from "@/lib/aai/stt-url";

const base = {
  token: "tok-123",
  sampleRate: 24000,
  keyterms: ["Rahul", "Sharma", "ULIP"],
  languageCodes: ["en", "hi"],
  prompt: "Bank branch conversation about a ULIP.",
};

describe("buildSttUrl", () => {
  it("targets the v3 streaming endpoint with the verified fixed parameters", () => {
    const url = new URL(buildSttUrl(base));
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(
      "wss://streaming.assemblyai.com/v3/ws",
    );
    const p = url.searchParams;
    expect(p.get("token")).toBe("tok-123");
    expect(p.get("speech_model")).toBe("universal-3-5-pro");
    expect(p.get("encoding")).toBe("pcm_s16le");
    expect(p.get("sample_rate")).toBe("24000");
    expect(p.get("speaker_labels")).toBe("true");
    expect(p.get("max_speakers")).toBe("2");
    expect(p.get("language_detection")).toBe("true");
    expect(p.get("voice_focus")).toBe("far-field");
    expect(p.get("format_turns")).toBe("true");
    expect(p.get("session_heartbeat")).toBe("true");
    expect(p.get("continuous_partials")).toBe("true");
  });

  it("omits mode because speaker_labels replaces the mode preset", () => {
    expect(new URL(buildSttUrl(base)).searchParams.has("mode")).toBe(false);
  });

  it("encodes language_codes and keyterms_prompt as JSON-array strings", () => {
    const raw = buildSttUrl(base);
    expect(raw).toContain("language_codes=%5B%22en%22%2C%22hi%22%5D");
    const p = new URL(raw).searchParams;
    expect(JSON.parse(p.get("language_codes")!)).toEqual(["en", "hi"]);
    expect(JSON.parse(p.get("keyterms_prompt")!)).toEqual(["Rahul", "Sharma", "ULIP"]);
    expect(p.get("prompt")).toBe("Bank branch conversation about a ULIP.");
  });

  it("drops keyterms over 50 characters and caps the list at 100", () => {
    const long = "x".repeat(51);
    const many = Array.from({ length: 150 }, (_, i) => `term${i}`);
    const p = new URL(buildSttUrl({ ...base, keyterms: [long, ...many] })).searchParams;
    const terms = JSON.parse(p.get("keyterms_prompt")!) as string[];
    expect(terms).not.toContain(long);
    expect(terms).toHaveLength(100);
    expect(terms[0]).toBe("term0");
  });

  it("truncates the prompt to 1750 characters", () => {
    const p = new URL(buildSttUrl({ ...base, prompt: "p".repeat(2000) })).searchParams;
    expect(p.get("prompt")).toHaveLength(1750);
  });

  it("leaves optional parameters out when not provided", () => {
    const p = new URL(buildSttUrl({ token: "t", sampleRate: 48000, keyterms: [] })).searchParams;
    expect(p.get("sample_rate")).toBe("48000");
    expect(p.has("keyterms_prompt")).toBe(false);
    expect(p.has("language_codes")).toBe(false);
    expect(p.has("prompt")).toBe(false);
  });
});
