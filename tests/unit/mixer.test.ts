import { describe, expect, it } from "vitest";
import { createFrameReader, mixInt16 } from "@/lib/audio/mixer";

// Judge-solo mode plays a pre-rendered advisor into the same stream as the judge's microphone, so
// Streaming STT hears two speakers and diarizes them (prd.md FR-11, trd.md section 8).

describe("mixInt16", () => {
  it("adds the two voices sample by sample", () => {
    const mic = Int16Array.from([100, -200, 300]);
    const advisor = Int16Array.from([10, 20, -30]);
    expect([...mixInt16(mic, advisor)]).toEqual([110, -180, 270]);
  });

  it("clips instead of wrapping around, which would sound like a bang", () => {
    const mic = Int16Array.from([32000, -32000]);
    const advisor = Int16Array.from([2000, -2000]);
    expect([...mixInt16(mic, advisor)]).toEqual([32767, -32768]);
  });

  it("leaves both inputs untouched, because the mic frame also goes elsewhere", () => {
    const mic = Int16Array.from([100, 200]);
    const advisor = Int16Array.from([1, 2]);
    mixInt16(mic, advisor);
    expect([...mic]).toEqual([100, 200]);
    expect([...advisor]).toEqual([1, 2]);
  });

  it("applies a gain to the added voice so it can sit under the microphone", () => {
    const mic = Int16Array.from([0, 0]);
    const advisor = Int16Array.from([1000, -1000]);
    expect([...mixInt16(mic, advisor, 0.5)]).toEqual([500, -500]);
  });

  it("mixes only the overlap when the added voice runs out mid frame", () => {
    const mic = Int16Array.from([100, 100, 100]);
    const advisor = Int16Array.from([1, 2]);
    expect([...mixInt16(mic, advisor)]).toEqual([101, 102, 100]);
  });

  it("ignores anything past the end of the frame", () => {
    const mic = Int16Array.from([100]);
    const advisor = Int16Array.from([1, 2, 3]);
    expect([...mixInt16(mic, advisor)]).toEqual([101]);
  });
});

describe("createFrameReader", () => {
  it("hands out frames in order", () => {
    const reader = createFrameReader(Int16Array.from([1, 2, 3, 4]), 2);
    expect([...reader.next()!]).toEqual([1, 2]);
    expect([...reader.next()!]).toEqual([3, 4]);
  });

  it("pads the last frame with silence so the pacing stays even", () => {
    const reader = createFrameReader(Int16Array.from([1, 2, 3]), 2);
    reader.next();
    expect([...reader.next()!]).toEqual([3, 0]);
  });

  it("reports done only after the last frame has been handed out", () => {
    const reader = createFrameReader(Int16Array.from([1, 2]), 2);
    expect(reader.done()).toBe(false);
    reader.next();
    expect(reader.done()).toBe(true);
    expect(reader.next()).toBeNull();
  });

  it("reports how far through the audio it is", () => {
    const reader = createFrameReader(Int16Array.from([1, 2, 3, 4]), 2);
    expect(reader.progress()).toEqual({ sample: 0, total: 4 });
    reader.next();
    expect(reader.progress()).toEqual({ sample: 2, total: 4 });
  });

  it("is done immediately when there is no audio", () => {
    const reader = createFrameReader(new Int16Array(0), 2);
    expect(reader.done()).toBe(true);
    expect(reader.next()).toBeNull();
  });
});
