// Streaming STT connection URL. Every parameter here was verified against the AssemblyAI streaming
// API spec on 2026-09-05 (see docs/decisions.md):
// - language_codes and keyterms_prompt travel as JSON-array strings, not repeated params.
// - format_turns must be true or turn_is_formatted never flips.
// - speaker_labels replaces the mode preset, so mode is not sent.
// - continuous_partials restores ~1 s partials under the diarization turn profile.
export const STT_WS_BASE = "wss://streaming.assemblyai.com/v3/ws";
export const STT_SPEECH_MODEL = "universal-3-5-pro";
export const STT_KEYTERM_MAX = 100;
export const STT_KEYTERM_MAX_CHARS = 50;
export const STT_PROMPT_MAX_CHARS = 1750;

export type SttUrlParams = {
  token: string;
  sampleRate: number;
  keyterms: string[];
  prompt?: string;
  languageCodes?: string[];
};

/** Trim, dedupe, drop terms over 50 chars (the server ignores them) and cap at 100 (the server errors). */
export function sanitizeKeyterms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const t = raw.trim();
    if (!t || t.length > STT_KEYTERM_MAX_CHARS || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length === STT_KEYTERM_MAX) break;
  }
  return out;
}

export function buildSttUrl(p: SttUrlParams): string {
  const q = new URLSearchParams({
    token: p.token,
    speech_model: STT_SPEECH_MODEL,
    encoding: "pcm_s16le",
    sample_rate: String(p.sampleRate),
    speaker_labels: "true",
    max_speakers: "2",
    language_detection: "true",
    voice_focus: "far-field",
    format_turns: "true",
    continuous_partials: "true",
    session_heartbeat: "true",
  });
  if (p.languageCodes && p.languageCodes.length > 0) {
    q.set("language_codes", JSON.stringify(p.languageCodes));
  }
  const terms = sanitizeKeyterms(p.keyterms);
  if (terms.length > 0) q.set("keyterms_prompt", JSON.stringify(terms));
  if (p.prompt) q.set("prompt", p.prompt.slice(0, STT_PROMPT_MAX_CHARS));
  return `${STT_WS_BASE}?${q.toString()}`;
}
