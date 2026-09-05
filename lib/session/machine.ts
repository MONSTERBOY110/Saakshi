// Session phase machine (trd.md section 2). Table driven, pure. Phase 1 uses START, ROLES_BOUND
// and ABORT; Phase 2 and 3 drive the remaining events.

export const PHASES = [
  "SETUP",
  "CALIBRATE",
  "OBSERVE",
  "INTERVENE",
  "NUDGE",
  "TEACHBACK",
  "CERTIFY",
  "DONE",
] as const;

export type Phase = (typeof PHASES)[number];

export type MachineEvent = {
  type:
    | "START"
    | "ROLES_BOUND"
    | "ABORT"
    | "INTERVENE_START"
    | "INTERVENE_DONE"
    | "VERIFY"
    | "NUDGE_DONE"
    | "TEACHBACK_DONE"
    | "CERTIFIED";
};

const TABLE: Record<Phase, Partial<Record<MachineEvent["type"], Phase>>> = {
  SETUP: { START: "CALIBRATE" },
  CALIBRATE: { ROLES_BOUND: "OBSERVE", ABORT: "DONE" },
  OBSERVE: { INTERVENE_START: "INTERVENE", VERIFY: "NUDGE", ABORT: "DONE" },
  INTERVENE: { INTERVENE_DONE: "OBSERVE" },
  NUDGE: { NUDGE_DONE: "TEACHBACK" },
  TEACHBACK: { TEACHBACK_DONE: "CERTIFY", ABORT: "DONE" },
  CERTIFY: { CERTIFIED: "DONE" },
  DONE: {},
};

/** Next phase, or null when the event is illegal in this phase. */
export function transition(phase: Phase, event: MachineEvent): Phase | null {
  return TABLE[phase][event.type] ?? null;
}

export type AudioGates = { micToEars: boolean; micToMouth: boolean };

/** Who hears the microphone in each phase (trd.md section 2 table). */
export function audioGates(phase: Phase): AudioGates {
  switch (phase) {
    case "CALIBRATE":
    case "OBSERVE":
    case "NUDGE":
      return { micToEars: true, micToMouth: false };
    case "INTERVENE":
    case "TEACHBACK":
      return { micToEars: true, micToMouth: true };
    default:
      return { micToEars: false, micToMouth: false };
  }
}
