import { normalise } from "@/lib/rules/normalise";

// Echo guard: the room microphone can hear Saakshi through the speakers when echo cancellation
// slips. A finalized turn whose words overwhelmingly come from something Saakshi just said is
// treated as echo and kept out of calibration and the rule engine.

export const ECHO_MIN_TOKENS = 5;
export const ECHO_THRESHOLD = 0.7;

export function isAgentEcho(
  turnText: string,
  recentAgentTexts: string[],
  threshold = ECHO_THRESHOLD,
): boolean {
  const turnTokens = tokens(turnText);
  if (turnTokens.length < ECHO_MIN_TOKENS || recentAgentTexts.length === 0) return false;
  for (const said of recentAgentTexts) {
    const vocabulary = new Set(tokens(said));
    if (vocabulary.size === 0) continue;
    const hits = turnTokens.filter((t) => vocabulary.has(t)).length;
    if (hits / turnTokens.length >= threshold) return true;
  }
  return false;
}

function tokens(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter((t) => t.length > 1);
}
