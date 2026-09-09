import { sanitizeKeyterms, STT_PROMPT_MAX_CHARS } from "@/lib/aai/stt-url";
import type { CompiledPack } from "@/lib/rules/pack";

// Session setup (P0-1) turned into STT and Voice Agent vocabulary, and the spoken calibration
// lines (P0-2). Everything the agent speaks: no markdown, no exclamation marks, under 25 words.

/**
 * What the recogniser is biased toward. The transcript is the evidence Saakshi judges, so the
 * default sends only identity terms (names, product, regulator): vocabulary that can never complete
 * a rule on its own. "full" adds the pack's disclosure and prohibited-claim vocabulary and exists
 * for the experiment that measured what that bias does; "none" is the control.
 */
export type KeytermsMode = "identity" | "full" | "none";

export const KEYTERMS_MODES: readonly KeytermsMode[] = ["identity", "full", "none"];

export function isKeytermsMode(value: unknown): value is KeytermsMode {
  return typeof value === "string" && (KEYTERMS_MODES as readonly string[]).includes(value);
}

/** The deployment's default, overridable per session for experiments. */
export function defaultKeytermsMode(): KeytermsMode {
  const v = process.env.NEXT_PUBLIC_KEYTERMS_MODE;
  return isKeytermsMode(v) ? v : "identity";
}

export type SessionSetup = {
  packId: string;
  advisorName: string;
  customerName: string;
  productName: string;
  productTerms: string[];
  /** Judge-solo (P0-10): the pack's advisor is played from a recording so one person can demo. */
  judgeSolo: boolean;
  /** Which vocabulary reaches the recogniser. Absent means the deployment default. */
  keytermsMode?: KeytermsMode;
};

export const DEFAULT_SETUP: SessionSetup = {
  packId: "insurance-ulip-in",
  advisorName: "Rahul",
  customerName: "Mrs. Sharma",
  productName: "ULIP",
  productTerms: [],
  // On unless the deployment says otherwise, so a judge who just opens the URL can run the demo.
  judgeSolo: process.env.NEXT_PUBLIC_JUDGE_SOLO_MODE !== "false",
  keytermsMode: defaultKeytermsMode(),
};

/** Names, product and the pack's identity vocabulary: terms that are never themselves evidence. */
export function identityKeyterms(setup: SessionSetup, pack: CompiledPack): string[] {
  return sanitizeKeyterms([
    setup.advisorName,
    setup.customerName,
    setup.productName,
    ...setup.productTerms,
    ...pack.keyterms,
  ]);
}

/** The vocabulary the rule engine listens for. Sent only in "full" mode. */
export function ruleKeyterms(pack: CompiledPack): string[] {
  return sanitizeKeyterms(pack.rule_keyterms);
}

/**
 * What both AssemblyAI sessions are told to listen for. People and product first (they matter
 * most for the transcript), then the pack's identity vocabulary, then, in "full" mode only, the
 * rule vocabulary.
 */
export function buildKeyterms(setup: SessionSetup, pack: CompiledPack): string[] {
  const mode = setup.keytermsMode ?? defaultKeytermsMode();
  if (mode === "none") return [];
  const identity = identityKeyterms(setup, pack);
  if (mode === "identity") return identity;
  return sanitizeKeyterms([...identity, ...ruleKeyterms(pack)]);
}

export function buildSttPrompt(setup: SessionSetup, pack: CompiledPack): string {
  const people = ` The advisor is ${setup.advisorName}. The customer is ${setup.customerName}. The product is ${setup.productName}.`;
  return `${pack.scenario_prompt}${people}`.slice(0, STT_PROMPT_MAX_CHARS);
}

export function buildGreeting(setup: SessionSetup): string {
  return `I am Saakshi. I will listen quietly and make sure everything important is covered. ${setup.advisorName}, please say your full name and your role.`;
}

export function buildCalibrationLine(setup: SessionSetup, step: "customer" | "done"): string {
  if (step === "customer") {
    return `Thank you, ${setup.advisorName}. ${setup.customerName}, please say your full name.`;
  }
  return "Thank you. I will listen quietly now and speak only if something important is missed.";
}
