import type { Role } from "@/lib/rules/engine";
import { normalise } from "@/lib/rules/normalise";
import { devanagariToRoman, hasDevanagari, loosen } from "./devanagari";

// Role calibration (P0-2). Saakshi asks the advisor, then the customer, to say their name, and
// the setup form already knows both names. A finalized turn that mentions exactly one of the
// names binds that role to its speaker label. Turns without a name fall back to order: the
// first labelled speaker is the advisor, the next distinct label is the customer. PENDING turns
// (under about one second) never bind. Swap and manual assignment are always available.

export type RolesState = {
  advisor?: string;
  customer?: string;
  step: "advisor" | "customer" | "done";
  /** Same-label answers seen while waiting for the second role. */
  attempts: number;
  /** Two same-label answers in a row: show the manual controls. */
  needsManual: boolean;
};

export type Names = { advisor: string; customer: string };

export const initialRoles = (): RolesState => ({
  step: "advisor",
  attempts: 0,
  needsManual: false,
});

/** Order-only binding (no transcript text available). */
export function observeFinalLabel(
  state: RolesState,
  label: string | undefined,
): { state: RolesState; bound?: Role } {
  if (!label || label === "PENDING" || state.step === "done") return { state };
  return bindPositional(state, label);
}

/** Name-aware binding from a finalized turn. */
export function observeFinalTurn(
  state: RolesState,
  turn: { label: string | undefined; text: string },
  names: Names,
): { state: RolesState; bound?: Role } {
  const { label } = turn;
  if (!label || label === "PENDING" || state.step === "done") return { state };
  const said = whoseName(turn.text, names);
  if (said === "advisor" && state.customer !== label) {
    if (state.advisor === label) return { state };
    return finish({ ...state, advisor: label }, "advisor");
  }
  if (said === "customer" && state.advisor !== label) {
    if (state.customer === label) return { state };
    return finish({ ...state, customer: label }, "customer");
  }
  return bindPositional(state, label);
}

/**
 * Bind a label to a role the room already knows for certain. Judge-solo is the case: the room
 * played the advisor's voice itself, so it does not have to infer who spoke from a name or from
 * speaking order, and calibration finishes on the first turn from each person.
 */
export function bindKnownSpeaker(
  state: RolesState,
  label: string | undefined,
  role: Role,
): { state: RolesState; bound?: Role } {
  if (!label || label === "PENDING" || state.step === "done") return { state };
  if (state[role] === label) return { state };
  // The other role already owns this label, so the room's guess about whose turn it is was wrong.
  const other: Role = role === "advisor" ? "customer" : "advisor";
  if (state[other] === label) return { state };
  return finish({ ...state, [role]: label }, role);
}

export function swapRoles(state: RolesState): RolesState {
  return { ...state, advisor: state.customer, customer: state.advisor };
}

export function assignRole(state: RolesState, role: Role, label: string): RolesState {
  const next: RolesState = { ...state, needsManual: false };
  if (role === "advisor") {
    next.advisor = label;
    if (next.customer === label) next.customer = undefined;
  } else {
    next.customer = label;
    if (next.advisor === label) next.advisor = undefined;
  }
  next.step = stepOf(next);
  return next;
}

export function roleOfLabel(state: RolesState, label: string | undefined): Role | undefined {
  if (!label || label === "PENDING") return undefined;
  if (label === state.advisor) return "advisor";
  if (label === state.customer) return "customer";
  return undefined;
}

export function rolesBound(state: RolesState): boolean {
  return state.step === "done" && !!state.advisor && !!state.customer;
}

/** Which participant's name a turn mentions, when it mentions exactly one. */
export function whoseName(text: string, names: Names): Role | undefined {
  const norm = ` ${normalise(text)} `;
  const mentions = (name: string) => nameTokens(name).some((tok) => norm.includes(` ${tok} `));
  let adv = mentions(names.advisor);
  let cus = mentions(names.customer);
  if (!adv && !cus && hasDevanagari(text)) {
    // The same sentence can arrive in either script (spike S7), and a name in Devanagari must bind
    // the role just as well. Transliteration is approximate, so this compares loosely and only for
    // names long enough that a chance substring is not a real risk.
    const roman = loosen(devanagariToRoman(text));
    const nearby = (name: string) =>
      nameTokens(name).some((tok) => tok.length >= 4 && roman.includes(loosen(tok)));
    adv = nearby(names.advisor);
    cus = nearby(names.customer);
  }
  if (adv && !cus) return "advisor";
  if (cus && !adv) return "customer";
  return undefined;
}

// ---------------------------------------------------------------- internals

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "shri", "smt", "ji", "sir", "madam"]);

function nameTokens(name: string): string[] {
  return normalise(name)
    .split(" ")
    .filter((t) => t.length >= 3 && !HONORIFICS.has(t));
}

function bindPositional(state: RolesState, label: string): { state: RolesState; bound?: Role } {
  if (!state.advisor && state.customer !== label) {
    return finish({ ...state, advisor: label }, "advisor");
  }
  if (!state.customer && state.advisor !== label) {
    return finish({ ...state, customer: label }, "customer");
  }
  const attempts = state.attempts + 1;
  return { state: { ...state, attempts, needsManual: attempts >= 2 } };
}

function finish(state: RolesState, bound: Role): { state: RolesState; bound: Role } {
  return { state: { ...state, step: stepOf(state), needsManual: false }, bound };
}

function stepOf(state: RolesState): RolesState["step"] {
  if (state.advisor && state.customer) return "done";
  return state.advisor ? "customer" : "advisor";
}
