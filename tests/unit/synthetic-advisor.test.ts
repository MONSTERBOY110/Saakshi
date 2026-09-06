import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoLine } from "@/lib/rules/pack";
import {
  createSyntheticAdvisor,
  CUSTOMER_TURN_TIMEOUT_MS,
  QUIET_WAIT_TIMEOUT_MS,
  type AdvisorState,
} from "@/lib/demo/synthetic-advisor";

// The synthetic advisor reads the pack's demo script so a judge alone only has to play the
// customer (prd.md P0-10). It paces at real time, because Streaming STT rejects audio sent faster
// than real time, and it waits between lines the way the script says.

const FRAME = 4; // samples per frame, small so the tests can count them
const FRAME_MS = 50;

const script: DemoLine[] = [
  { id: "d01", text_en: "Line one.", text_display: "Line one.", wait_for: "customer_turn" },
  { id: "d02", text_en: "Line two.", text_display: "Line two.", wait_for: "ms:6000" },
  { id: "d03", text_en: "Line three.", text_display: "Line three.", wait_for: "click" },
];

/** Two frames of audio per line, each sample tagged with the line number so frames are traceable. */
function audioFor(id: string): Int16Array {
  const n = Number(id.slice(1));
  return Int16Array.from([n, n, n, n, n, n, n, n]);
}

function harness(lines: DemoLine[] = script) {
  const frames: Int16Array[] = [];
  const states: AdvisorState[] = [];
  const advisor = createSyntheticAdvisor({
    script: lines,
    loadAudio: async (id) => audioFor(id),
    frameSamples: FRAME,
    frameMs: FRAME_MS,
    onFrame: (pcm) => frames.push(pcm),
    onState: (s) => states.push(s),
  });
  return { advisor, frames, states };
}

/** Let the pending audio load resolve and then run the paced frames. */
async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createSyntheticAdvisor", () => {
  it("speaks the first line as paced frames, in order", async () => {
    const h = harness();
    void h.advisor.start();
    await settle(FRAME_MS * 3);
    expect(h.frames.map((f) => f[0])).toEqual([1, 1]);
    expect(h.advisor.state().status).toBe("waiting");
    expect(h.advisor.state().lineId).toBe("d01");
  });

  it("paces at real time rather than dumping the whole line at once", async () => {
    const h = harness();
    void h.advisor.start();
    await settle(0);
    expect(h.frames).toHaveLength(1);
    await settle(FRAME_MS);
    expect(h.frames).toHaveLength(2);
  });

  it("waits for the customer before the line that says so", async () => {
    const h = harness();
    void h.advisor.start();
    await settle(FRAME_MS * 3);
    expect(h.advisor.state().waitingFor).toBe("customer_turn");

    await settle(10_000);
    expect(h.frames.map((f) => f[0])).toEqual([1, 1]);

    h.advisor.customerSpoke();
    await settle(FRAME_MS * 3);
    expect(h.frames.map((f) => f[0])).toEqual([1, 1, 2, 2]);
  });

  it("moves on by itself if the customer never speaks, so the demo cannot stall", async () => {
    const h = harness();
    void h.advisor.start();
    await settle(FRAME_MS * 3);
    await settle(CUSTOMER_TURN_TIMEOUT_MS + FRAME_MS * 3);
    expect(h.frames.map((f) => f[0])).toEqual([1, 1, 2, 2]);
  });

  it("waits the number of milliseconds the script asks for", async () => {
    const h = harness();
    void h.advisor.start();
    await settle(FRAME_MS * 3);
    h.advisor.customerSpoke();
    await settle(FRAME_MS * 3);
    expect(h.advisor.state().waitingFor).toBe("ms:6000");

    await settle(5_000);
    expect(h.frames.map((f) => f[0])).toEqual([1, 1, 2, 2]);
    await settle(1_000 + FRAME_MS * 3);
    expect(h.frames.map((f) => f[0])).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("waits for a click when the script says click", async () => {
    const h = harness([
      { id: "d01", text_en: "One.", text_display: "One.", wait_for: "click" },
      { id: "d02", text_en: "Two.", text_display: "Two.", wait_for: "click" },
    ]);
    void h.advisor.start();
    await settle(FRAME_MS * 3);
    await settle(60_000);
    expect(h.frames.map((f) => f[0])).toEqual([1, 1]);

    h.advisor.advance();
    await settle(FRAME_MS * 3);
    expect(h.frames.map((f) => f[0])).toEqual([1, 1, 2, 2]);
  });

  it("lets the operator skip a wait early", async () => {
    const h = harness();
    void h.advisor.start();
    await settle(FRAME_MS * 3);
    h.advisor.advance();
    await settle(FRAME_MS * 3);
    expect(h.frames.map((f) => f[0])).toEqual([1, 1, 2, 2]);
  });

  it("finishes after the last line and stops emitting", async () => {
    const h = harness([{ id: "d01", text_en: "Only.", text_display: "Only.", wait_for: "ms:100" }]);
    void h.advisor.start();
    await settle(FRAME_MS * 3 + 200);
    expect(h.advisor.state().status).toBe("done");
    const count = h.frames.length;
    await settle(10_000);
    expect(h.frames).toHaveLength(count);
  });

  it("stops on request and emits nothing more", async () => {
    const h = harness();
    void h.advisor.start();
    await settle(0);
    h.advisor.stop();
    const count = h.frames.length;
    await settle(10_000);
    expect(h.frames).toHaveLength(count);
    expect(h.advisor.state().status).toBe("idle");
  });

  it("reports each line it starts so the room can show the script position", async () => {
    const h = harness();
    void h.advisor.start();
    await settle(FRAME_MS * 3);
    const speaking = h.states.filter((s) => s.status === "speaking");
    expect(speaking.map((s) => s.lineId)).toEqual(["d01"]);
    expect(speaking[0]?.index).toBe(0);
  });

  it("skips a line whose audio has not been rendered rather than stopping the demo", async () => {
    const frames: Int16Array[] = [];
    const advisor = createSyntheticAdvisor({
      script,
      loadAudio: async (id) => {
        if (id === "d01") throw new Error("404");
        return audioFor(id);
      },
      frameSamples: FRAME,
      frameMs: FRAME_MS,
      onFrame: (pcm) => frames.push(pcm),
      onState: () => {},
    });
    void advisor.start();
    await settle(FRAME_MS * 6);
    expect(frames.map((f) => f[0])).toEqual([2, 2]);
  });
});

describe("waiting for a quiet moment", () => {
  it("holds a line back while the customer is still talking", async () => {
    let quiet = false;
    const frames: Int16Array[] = [];
    const advisor = createSyntheticAdvisor({
      script: [{ id: "d01", text_en: "One.", text_display: "One.", wait_for: "click" }],
      loadAudio: async (id) => audioFor(id),
      frameSamples: FRAME,
      frameMs: FRAME_MS,
      canSpeak: () => quiet,
      onFrame: (pcm) => frames.push(pcm),
      onState: () => {},
    });
    void advisor.start();
    await settle(2_000);
    expect(frames).toHaveLength(0);

    quiet = true;
    // Promptly, without asserting the exact poll interval.
    await settle(1_000);
    expect(frames).toHaveLength(2);
  });

  it("speaks anyway rather than going silent forever", async () => {
    const frames: Int16Array[] = [];
    const advisor = createSyntheticAdvisor({
      script: [{ id: "d01", text_en: "One.", text_display: "One.", wait_for: "click" }],
      loadAudio: async (id) => audioFor(id),
      frameSamples: FRAME,
      frameMs: FRAME_MS,
      canSpeak: () => false,
      onFrame: (pcm) => frames.push(pcm),
      onState: () => {},
    });
    void advisor.start();
    await settle(QUIET_WAIT_TIMEOUT_MS + FRAME_MS * 4);
    expect(frames).toHaveLength(2);
  });
});

describe("spokeRecently", () => {
  it("is false before the advisor has said anything", () => {
    const h = harness();
    expect(h.advisor.spokeRecently()).toBe(false);
  });

  it("is true while a line is playing", async () => {
    const h = harness();
    void h.advisor.start();
    await settle(0);
    expect(h.advisor.spokeRecently()).toBe(true);
  });

  it("stays true just after a line, while its turn is still being finalized", async () => {
    const h = harness();
    void h.advisor.start();
    await settle(FRAME_MS * 3);
    expect(h.advisor.state().status).toBe("waiting");
    expect(h.advisor.spokeRecently(2_500)).toBe(true);
  });

  it("goes false once the room has been quiet long enough for someone else to answer", async () => {
    const h = harness();
    void h.advisor.start();
    await settle(FRAME_MS * 3);
    await settle(3_000);
    expect(h.advisor.spokeRecently(2_500)).toBe(false);
  });
});
