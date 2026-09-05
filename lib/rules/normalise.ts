// Text normalisation shared by the rule engine and the transcript view. Pure functions.

const DEVANAGARI = /[ऀ-ॿ]/u;
const LATIN = /[A-Za-z]/;

/**
 * NFC, lower case, apostrophes removed, digit groups joined (50,000 -> 50000), every other
 * punctuation or symbol turned into a space (hyphens included, so "lock-in" and "lock in" agree),
 * whitespace collapsed. Letters (any script), combining marks (Devanagari vowel signs), digits
 * and the percent sign survive.
 */
export function normalise(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/(\d)[,.](?=\d{3}(?!\d))/g, "$1")
    .replace(/[^\p{L}\p{M}\p{N}\s%]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasDevanagari(text: string): boolean {
  return DEVANAGARI.test(text);
}

export function hasLatin(text: string): boolean {
  return LATIN.test(text);
}

/**
 * Display tag for a turn: "hi+en" when both scripts appear, otherwise the detected language
 * when it is one we support, otherwise the script that is present.
 */
export function languageTag(text: string, languageCode: string | undefined): string {
  const dev = hasDevanagari(text);
  const lat = hasLatin(text);
  if (dev && lat) return "hi+en";
  if (dev) return "hi";
  if (languageCode === "en" || languageCode === "hi") return languageCode;
  return "en";
}
