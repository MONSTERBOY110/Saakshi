// Streaming STT returns Hindi in Devanagari or in Roman, and which one it picks for a given
// sentence is not stable between runs (spike S7). On one golden run the customer's English
// introduction came back as "माय नेम इस मिसेज शर्मा", so name-based role calibration missed it and
// the room bound the roles by speaking order instead, backwards. This transliterates Devanagari
// well enough to recognise a name; it is not a general romanisation and does not try to be.

const VOWELS: Record<string, string> = {
  अ: "a",
  आ: "aa",
  इ: "i",
  ई: "ii",
  उ: "u",
  ऊ: "uu",
  ऋ: "ri",
  ए: "e",
  ऐ: "ai",
  ओ: "o",
  औ: "au",
};

const MATRAS: Record<string, string> = {
  "ा": "aa",
  "ि": "i",
  "ी": "ii",
  "ु": "u",
  "ू": "uu",
  "ृ": "ri",
  "े": "e",
  "ै": "ai",
  "ो": "o",
  "ौ": "au",
};

const CONSONANTS: Record<string, string> = {
  क: "k",
  ख: "kh",
  ग: "g",
  घ: "gh",
  ङ: "n",
  च: "ch",
  छ: "chh",
  ज: "j",
  झ: "jh",
  ञ: "n",
  ट: "t",
  ठ: "th",
  ड: "d",
  ढ: "dh",
  ण: "n",
  त: "t",
  थ: "th",
  द: "d",
  ध: "dh",
  न: "n",
  प: "p",
  फ: "ph",
  ब: "b",
  भ: "bh",
  म: "m",
  य: "y",
  र: "r",
  ल: "l",
  ळ: "l",
  व: "v",
  श: "sh",
  ष: "sh",
  स: "s",
  ह: "h",
};

const VIRAMA = "्";
const NASALS = new Set(["ं", "ँ"]);
const VISARGA = "ः";
const NUKTA = "़";

export function hasDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

/**
 * A rough Roman form of any Devanagari in the text, good enough to spot a name. Consonants carry
 * an inherent "a" unless a matra or a virama follows. Latin characters pass through unchanged, so
 * a mixed Hinglish sentence comes out readable.
 */
export function devanagariToRoman(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === NUKTA) continue;
    if (NASALS.has(ch)) {
      out += "n";
      continue;
    }
    if (ch === VISARGA) {
      out += "h";
      continue;
    }
    const vowel = VOWELS[ch];
    if (vowel) {
      out += vowel;
      continue;
    }
    const consonant = CONSONANTS[ch];
    if (!consonant) {
      // Matras and viramas are consumed with their consonant; a stray one is dropped.
      if (!MATRAS[ch] && ch !== VIRAMA) out += ch;
      continue;
    }
    out += consonant;
    const next = text[i + 1];
    if (next === VIRAMA) {
      i += 1;
      continue;
    }
    const matra = next ? MATRAS[next] : undefined;
    if (matra) {
      out += matra;
      i += 1;
      continue;
    }
    out += "a";
  }
  return out;
}

/**
 * Squash the spelling differences transliteration leaves behind, so "shaarmaa" and "sharma" are the
 * same string to a comparison: lower case, doubled vowels collapsed, everything else dropped.
 */
export function loosen(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .replace(/([aeiou])\1+/g, "$1")
    .trim();
}
