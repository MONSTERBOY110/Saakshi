// Phase 2: session state machine (SETUP → CALIBRATE → OBSERVE → INTERVENE → NUDGE → TEACHBACK → CERTIFY → DONE).
export type Phase =
  "SETUP" | "CALIBRATE" | "OBSERVE" | "INTERVENE" | "NUDGE" | "TEACHBACK" | "CERTIFY" | "DONE";
