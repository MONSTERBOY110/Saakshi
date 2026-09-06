import type { CompiledPack } from "@/lib/rules/pack";
import type { BoardState } from "./board";
import type { SessionSetup } from "./keyterms";

// Everything Saakshi says during an intervention or a nudge is composed here, never by the LLM:
// no markdown, no exclamation marks, at most 25 words (CLAUDE.md), correction text from the pack.

/** How long the microphone reaches the Voice Agent after a correction, for an acknowledgement. */
export const ACK_WINDOW_MS = 8000;
export const MAX_SPOKEN_WORDS = 25;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** "{advisor}, a quick flag. {correction} {customer}, please note." within the word budget. */
export function composeIntervention(setup: SessionSetup, correction: string): string {
  const head = `${setup.advisorName}, a quick flag.`;
  const body = correction.trim();
  const full = `${head} ${body} ${setup.customerName}, please note.`;
  if (wordCount(full) <= MAX_SPOKEN_WORDS) return full;
  return `${head} ${body}`;
}

/** One sentence naming the missing disclosures, or null when everything was covered. */
export function composeNudge(pack: CompiledPack, board: BoardState): string | null {
  const missing = board.checkpoints.filter((c) => c.status === "pending");
  if (missing.length === 0) return null;
  const names = missing.map((c) => spokenLabel(pack, c.id, c.label));
  if (names.length === 1) return `Before we finish, ${names[0]} has not been mentioned.`;
  if (names.length <= 3) {
    return `Before we finish, ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} have not been mentioned.`;
  }
  return `Before we finish, ${names[0]}, ${names[1]} and ${names.length - 2} more disclosures have not been mentioned.`;
}

export const ALL_COVERED_LINE = "Every required disclosure has been covered. Thank you.";

function spokenLabel(pack: CompiledPack, id: string, label: string): string {
  return pack.checkpoints.find((c) => c.id === id)?.spoken ?? `the ${label.toLowerCase()}`;
}
