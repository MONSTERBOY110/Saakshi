import { sanitizeKeyterms, STT_PROMPT_MAX_CHARS } from "@/lib/aai/stt-url";
import type { CompiledPack } from "@/lib/rules/pack";

// Session setup (P0-1) turned into STT and Voice Agent vocabulary, and the spoken calibration
// lines (P0-2). Everything the agent speaks: no markdown, no exclamation marks, under 25 words.

export type SessionSetup = {
  packId: string;
  advisorName: string;
  customerName: string;
  productName: string;
  productTerms: string[];
  /** Judge-solo (P0-10): the pack's advisor is played from a recording so one person can demo. */
  judgeSolo: boolean;
};

export const DEFAULT_SETUP: SessionSetup = {
  packId: "insurance-ulip-in",
  advisorName: "Rahul",
  customerName: "Mrs. Sharma",
  productName: "ULIP",
  productTerms: [],
  // On unless the deployment says otherwise, so a judge who just opens the URL can run the demo.
  judgeSolo: process.env.NEXT_PUBLIC_JUDGE_SOLO_MODE !== "false",
};

/** People and product first (they matter most for the transcript), then the pack vocabulary. */
export function buildKeyterms(setup: SessionSetup, pack: CompiledPack): string[] {
  return sanitizeKeyterms([
    setup.advisorName,
    setup.customerName,
    setup.productName,
    ...setup.productTerms,
    ...pack.keyterms,
  ]);
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
