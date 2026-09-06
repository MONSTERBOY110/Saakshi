import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/audio/router";
import type { AudioGates } from "@/lib/session/machine";

// Judge-solo routing (prd.md FR-11): the synthetic advisor is mixed into what Streaming STT hears,
// so diarization finds two speakers, and is never sent to the Voice Agent, which must not hear its
// own script and start answering it.

function harness(gates: AudioGates, synthetic: Int16Array[] = []) {
  const ears: Int16Array[] = [];
  const mouth: Int16Array[] = [];
  const queue = [...synthetic];
  const router = createRouter({
    gates: () => gates,
    sinks: {
      ears: (pcm) => {
        ears.push(pcm);
        return true;
      },
      mouth: (pcm) => {
        mouth.push(pcm);
        return true;
      },
    },
    nextSynthetic: () => queue.shift() ?? null,
  });
  return { router, ears, mouth, queue };
}

const OPEN: AudioGates = { micToEars: true, micToMouth: true };
const OBSERVE: AudioGates = { micToEars: true, micToMouth: false };
const CLOSED: AudioGates = { micToEars: false, micToMouth: false };

describe("createRouter with a synthetic advisor", () => {
  it("mixes the advisor into the frame Streaming STT hears", () => {
    const h = harness(OBSERVE, [Int16Array.from([10, 20])]);
    h.router.push(Int16Array.from([1, 2]));
    expect([...h.ears[0]!]).toEqual([11, 22]);
  });

  it("sends the microphone alone to the Voice Agent, never the advisor", () => {
    const h = harness(OPEN, [Int16Array.from([10, 20])]);
    h.router.push(Int16Array.from([1, 2]));
    expect([...h.ears[0]!]).toEqual([11, 22]);
    expect([...h.mouth[0]!]).toEqual([1, 2]);
  });

  it("passes the microphone through untouched when the advisor is silent", () => {
    const h = harness(OBSERVE);
    h.router.push(Int16Array.from([1, 2]));
    expect([...h.ears[0]!]).toEqual([1, 2]);
  });

  it("takes one advisor frame per microphone frame, in order", () => {
    const h = harness(OBSERVE, [Int16Array.from([10]), Int16Array.from([20])]);
    h.router.push(Int16Array.from([1]));
    h.router.push(Int16Array.from([1]));
    h.router.push(Int16Array.from([1]));
    expect(h.ears.map((f) => f[0])).toEqual([11, 21, 1]);
  });

  it("leaves the advisor queued while the Ears gate is shut", () => {
    const h = harness(CLOSED, [Int16Array.from([10])]);
    h.router.push(Int16Array.from([1]));
    expect(h.ears).toHaveLength(0);
    expect(h.queue).toHaveLength(1);
  });

  it("counts the advisor frames it mixed", () => {
    const h = harness(OBSERVE, [Int16Array.from([10])]);
    h.router.push(Int16Array.from([1]));
    h.router.push(Int16Array.from([1]));
    expect(h.router.stats().syntheticMixed).toBe(1);
  });
});
