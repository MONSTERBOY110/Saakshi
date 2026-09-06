import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/audio/router";
import { isAgentEcho } from "@/lib/session/echo";
import { isVerifyTrigger } from "@/lib/session/verify-trigger";

describe("isAgentEcho", () => {
  const said = [
    "I am Saakshi. I will listen quietly and make sure everything important is covered. Rahul, please say your full name and your role.",
    "Rahul, a quick flag. Returns on a market-linked plan cannot be called guaranteed. Mrs. Sharma, please note.",
  ];

  it("recognises the microphone hearing Saakshi through the speakers", () => {
    expect(
      isAgentEcho(
        "Rahul a quick flag returns on a market linked plan cannot be called guaranteed",
        said,
      ),
    ).toBe(true);
    expect(isAgentEcho("please say your full name and your role.", said)).toBe(true);
  });

  it("does not flag genuine speech that merely shares a few words", () => {
    expect(isAgentEcho("There is a 5-year lock-in.", said)).toBe(false);
    expect(isAgentEcho("Returns are not guaranteed, Mrs. Sharma, the market decides.", said)).toBe(
      false,
    );
    expect(isAgentEcho("My name is Rahul.", said)).toBe(false);
  });

  it("ignores very short turns and empty history", () => {
    expect(isAgentEcho("Rahul.", said)).toBe(false);
    expect(isAgentEcho("please note", [])).toBe(false);
  });
});

describe("isVerifyTrigger", () => {
  it("fires on the spoken cue in its recognised variants", () => {
    for (const t of [
      "Saakshi, verify.",
      "Saakshi. clarify.",
      "Sakshi verify karo.",
      "Okay Saakshi, please check.",
      "साक्षी verify",
    ]) {
      expect(isVerifyTrigger(t), t).toBe(true);
    }
  });

  it("stays quiet without the name or without the verb", () => {
    for (const t of [
      "Please verify the documents.",
      "Saakshi, are you there?",
      "Let me check the illustration.",
      "",
    ]) {
      expect(isVerifyTrigger(t), t).toBe(false);
    }
  });
});

describe("createRouter", () => {
  const frame = new Int16Array(1200); // 50 ms at 24 kHz

  function make(gates: { micToEars: boolean; micToMouth: boolean }) {
    let now = 0;
    const sent = { ears: 0, mouth: 0 };
    const router = createRouter({
      gates: () => gates,
      sinks: {
        ears: () => {
          sent.ears += 1;
          return true;
        },
        mouth: () => {
          sent.mouth += 1;
          return true;
        },
      },
      now: () => now,
      frameMs: 50,
      maxLeadMs: 1000,
    });
    return { router, sent, tick: (ms: number) => (now += ms) };
  }

  it("sends to nobody when both gates are closed", () => {
    const { router, sent } = make({ micToEars: false, micToMouth: false });
    expect(router.push(frame)).toEqual({ ears: false, mouth: false, dropped: false });
    expect(sent).toEqual({ ears: 0, mouth: 0 });
  });

  it("sends to the ears only in OBSERVE-like gates", () => {
    const { router, sent } = make({ micToEars: true, micToMouth: false });
    router.push(frame);
    expect(sent).toEqual({ ears: 1, mouth: 0 });
  });

  it("paces the mouth to real time and never drops for the ears", () => {
    const { router, sent, tick } = make({ micToEars: true, micToMouth: true });
    let dropped = 0;
    // 40 frames (2 s of audio) arriving within 100 ms of wall time.
    for (let i = 0; i < 40; i++) {
      const r = router.push(frame);
      if (r.dropped) dropped += 1;
      tick(2.5);
    }
    expect(sent.ears).toBe(40);
    expect(sent.mouth).toBeGreaterThanOrEqual(20);
    expect(sent.mouth).toBeLessThan(40);
    expect(dropped).toBe(40 - sent.mouth);
    expect(router.stats()).toMatchObject({
      frames: 40,
      earsSent: 40,
      mouthSent: sent.mouth,
      dropped,
    });
  });

  it("resets pacing when the mouth gate reopens", () => {
    const gates = { micToEars: true, micToMouth: true };
    const { router, sent, tick } = make(gates);
    for (let i = 0; i < 30; i++) router.push(frame); // burst, some dropped
    gates.micToMouth = false;
    router.push(frame);
    tick(5000);
    gates.micToMouth = true;
    const before = sent.mouth;
    for (let i = 0; i < 10; i++) {
      router.push(frame);
      tick(50);
    }
    expect(sent.mouth - before).toBe(10);
  });
});
