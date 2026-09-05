import { describe, expect, it } from "vitest";
import {
  audioGates,
  PHASES,
  transition,
  type MachineEvent,
  type Phase,
} from "@/lib/session/machine";

const legal: Array<[Phase, MachineEvent["type"], Phase]> = [
  ["SETUP", "START", "CALIBRATE"],
  ["CALIBRATE", "ROLES_BOUND", "OBSERVE"],
  ["CALIBRATE", "ABORT", "DONE"],
  ["OBSERVE", "INTERVENE_START", "INTERVENE"],
  ["INTERVENE", "INTERVENE_DONE", "OBSERVE"],
  ["OBSERVE", "VERIFY", "NUDGE"],
  ["NUDGE", "NUDGE_DONE", "TEACHBACK"],
  ["TEACHBACK", "TEACHBACK_DONE", "CERTIFY"],
  ["CERTIFY", "CERTIFIED", "DONE"],
  ["OBSERVE", "ABORT", "DONE"],
  ["TEACHBACK", "ABORT", "DONE"],
];

describe("phase machine", () => {
  it.each(legal)("%s + %s -> %s", (from, type, to) => {
    expect(transition(from, { type } as MachineEvent)).toBe(to);
  });

  it("rejects illegal transitions with null and never leaves DONE", () => {
    expect(transition("SETUP", { type: "ROLES_BOUND" })).toBeNull();
    expect(transition("OBSERVE", { type: "START" })).toBeNull();
    expect(transition("INTERVENE", { type: "VERIFY" })).toBeNull();
    expect(transition("CERTIFY", { type: "ABORT" })).toBeNull();
    for (const type of ["START", "ROLES_BOUND", "ABORT", "VERIFY", "CERTIFIED"] as const) {
      expect(transition("DONE", { type })).toBeNull();
    }
  });

  it("lists the eight phases in order", () => {
    expect(PHASES).toEqual([
      "SETUP",
      "CALIBRATE",
      "OBSERVE",
      "INTERVENE",
      "NUDGE",
      "TEACHBACK",
      "CERTIFY",
      "DONE",
    ]);
  });

  it("gates audio per trd.md section 2", () => {
    expect(audioGates("SETUP")).toEqual({ micToEars: false, micToMouth: false });
    expect(audioGates("CALIBRATE")).toEqual({ micToEars: true, micToMouth: false });
    expect(audioGates("OBSERVE")).toEqual({ micToEars: true, micToMouth: false });
    expect(audioGates("INTERVENE")).toEqual({ micToEars: true, micToMouth: true });
    expect(audioGates("NUDGE")).toEqual({ micToEars: true, micToMouth: false });
    expect(audioGates("TEACHBACK")).toEqual({ micToEars: true, micToMouth: true });
    expect(audioGates("CERTIFY")).toEqual({ micToEars: false, micToMouth: false });
    expect(audioGates("DONE")).toEqual({ micToEars: false, micToMouth: false });
  });
});
