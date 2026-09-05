import { describe, expect, it } from "vitest";
import { BASELINE_TURN_DETECTION, buildInitialSession } from "@/lib/aai/agent-config";

const opts = {
  systemPrompt: "You are Saakshi, a calm compliance witness.",
  greeting: "I am Saakshi. Please say your name.",
  keyterms: ["Rahul", "Sharma", "ULIP"],
};

describe("buildInitialSession", () => {
  it("wraps the config in a session.update envelope", () => {
    const msg = buildInitialSession(opts);
    expect(msg.type).toBe("session.update");
    expect(msg.session.system_prompt).toBe(opts.systemPrompt);
    expect(msg.session.greeting).toBe(opts.greeting);
    expect(msg.session.tools).toEqual([]);
  });

  it("declares audio/pcm formats with no sample_rate field (encoding fixes 24 kHz)", () => {
    const { session } = buildInitialSession(opts);
    expect(session.input.format).toEqual({ encoding: "audio/pcm" });
    expect(session.output.format).toEqual({ encoding: "audio/pcm" });
    expect("sample_rate" in session.input.format).toBe(false);
  });

  it("defaults to the anna voice at full volume", () => {
    const { session } = buildInitialSession(opts);
    expect(session.output).toEqual({
      voice: "anna",
      format: { encoding: "audio/pcm" },
      volume: 100,
    });
    expect(buildInitialSession({ ...opts, voice: "george" }).session.output.voice).toBe("george");
  });

  it("uses the human-feeling turn detection baseline and far-field voice focus", () => {
    const { session } = buildInitialSession(opts);
    expect(session.input.turn_detection).toEqual(BASELINE_TURN_DETECTION);
    expect(BASELINE_TURN_DETECTION).toEqual({
      vad_threshold: 0.5,
      min_silence: 1400,
      max_silence: 4000,
      interrupt_response: true,
    });
    expect(session.input.voice_focus).toBe("far-field");
  });

  it("caps keyterms at 100 and only sets language_codes when given", () => {
    const many = Array.from({ length: 120 }, (_, i) => `k${i}`);
    const { session } = buildInitialSession({ ...opts, keyterms: many });
    expect(session.input.keyterms).toHaveLength(100);
    expect("language_codes" in session.input).toBe(false);
    const withLang = buildInitialSession({ ...opts, languageCodes: ["en", "hi"] });
    expect(withLang.session.input.language_codes).toEqual(["en", "hi"]);
  });

  it("refuses greetings with markdown or exclamation marks", () => {
    expect(() => buildInitialSession({ ...opts, greeting: "Hello!" })).toThrow();
    expect(() => buildInitialSession({ ...opts, greeting: "**Hi** there" })).toThrow();
  });
});
