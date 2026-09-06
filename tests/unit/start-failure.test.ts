import { describe, expect, it } from "vitest";
import { startFailureMessage } from "@/lib/session/controller";

// The first thing anyone does with this product is press Start before reading anything, so the
// message they get when it fails has to name the thing they can actually do next.

function err(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe("startFailureMessage", () => {
  it("tells someone who blocked the microphone how to unblock it", () => {
    const m = startFailureMessage(err("NotAllowedError", "Permission denied"));
    expect(m).toContain("Allow it in the browser");
    expect(m).toContain("Start again");
  });

  it("recognises a denial from the message alone, when the name is missing", () => {
    expect(startFailureMessage(new Error("getUserMedia permission denied"))).toContain(
      "Allow it in the browser",
    );
  });

  it("tells someone with no microphone to plug one in", () => {
    expect(startFailureMessage(err("NotFoundError", "Requested device not found"))).toContain(
      "No microphone was found",
    );
  });

  it("tells someone whose microphone is taken to close the other app", () => {
    expect(startFailureMessage(err("NotReadableError", "Device in use"))).toContain(
      "in use by another app",
    );
  });

  it("names the API key when the token could not be minted", () => {
    const m = startFailureMessage(new Error("/api/token/stt responded 502"));
    expect(m).toContain("could not reach AssemblyAI");
    expect(m).toContain("API key");
  });

  it("still says something useful for a cause it does not recognise", () => {
    const m = startFailureMessage(new Error("AudioContext failed to resume"));
    expect(m).toContain("could not start");
    expect(m).toContain("AudioContext failed to resume");
  });

  it("never leaves the reader with a bare object", () => {
    expect(startFailureMessage({ weird: true })).toContain("could not start");
  });
});
