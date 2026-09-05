import { describe, expect, it } from "vitest";
import { base64ToInt16, floatToInt16, int16ToBase64, resampleLinear } from "@/lib/audio/pcm";

describe("floatToInt16", () => {
  it("scales and clamps float samples into the int16 range", () => {
    const out = floatToInt16(new Float32Array([0, 1.5, -1.5, 0.5, -0.5]));
    expect(Array.from(out)).toEqual([0, 32767, -32768, 16383, -16384]);
  });
});

describe("int16ToBase64 / base64ToInt16", () => {
  it("encodes little-endian bytes", () => {
    expect(int16ToBase64(new Int16Array([1, -1]))).toBe("AQD//w==");
  });

  it("round-trips arbitrary samples", () => {
    const samples = new Int16Array([0, 1, -1, 32767, -32768, 1234, -4321]);
    expect(Array.from(base64ToInt16(int16ToBase64(samples)))).toEqual(Array.from(samples));
  });

  it("handles a 1200-sample frame (50 ms at 24 kHz) without truncation", () => {
    const frame = new Int16Array(1200).map((_, i) => ((i * 37) % 65536) - 32768);
    expect(base64ToInt16(int16ToBase64(frame)).length).toBe(1200);
  });
});

describe("resampleLinear", () => {
  it("returns the input untouched when rates match", () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleLinear(input, 24000, 24000)).toBe(input);
  });

  it("halves a 48 kHz ramp to 24 kHz and keeps the endpoints", () => {
    const input = new Float32Array(48).map((_, i) => i / 47);
    const out = resampleLinear(input, 48000, 24000);
    expect(out.length).toBe(24);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[out.length - 1]!).toBeGreaterThan(0.9);
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeGreaterThan(out[i - 1]!);
  });

  it("upsamples 16 kHz to 24 kHz with a 3:2 length ratio", () => {
    const out = resampleLinear(new Float32Array(160), 16000, 24000);
    expect(out.length).toBe(240);
  });
});
