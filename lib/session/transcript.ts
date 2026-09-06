import type { SpeakerRevision, Turn, TurnWord } from "@/lib/aai/types";
import type { Role } from "@/lib/rules/engine";
import { languageTag } from "@/lib/rules/normalise";

// Pure reducer for the live transcript: partials render live, finals lock, revisions fill in
// PENDING turns and annotate labelled ones. Turn orders are the STT turn_order values (offset on
// reconnect by the Ears client).

export type RoleOf = (label: string | undefined) => Role | undefined;

export type StoredTurn = {
  order: number;
  text: string;
  final: boolean;
  formatted: boolean;
  speakerLabel?: string;
  role?: Role;
  /** Display tag: en, hi, or hi+en for mixed-script turns. */
  language: string;
  languageCode?: string;
  languageConfidence?: number;
  startMs: number;
  endMs: number;
  words: TurnWord[];
  /** Touched by the end-of-session SpeakerRevision. */
  revised: boolean;
  /** Label the revision proposed for a turn that already had a live label (kept as a note). */
  revisedLabel?: string;
  /** Final turn whose speaker is PENDING (under about one second) or unlabelled. */
  pending: boolean;
  /** The microphone heard Saakshi through the speakers; excluded from rules and calibration. */
  echo?: boolean;
};

export type TranscriptState = { turns: StoredTurn[] };

export const emptyTranscript = (): TranscriptState => ({ turns: [] });

export type ApplyTurnResult = {
  state: TranscriptState;
  /** Set the first time a turn becomes final; run the rules on it. */
  finalized?: StoredTurn;
  /** Set when a formatted final replaces an earlier final for the same turn. */
  updated?: StoredTurn;
};

export function applyTurn(state: TranscriptState, turn: Turn, roleOf: RoleOf): ApplyTurnResult {
  const idx = state.turns.findIndex((t) => t.order === turn.turn_order);
  const existing = idx >= 0 ? state.turns[idx] : undefined;

  if (!turn.end_of_turn) {
    if (existing?.final) return { state };
    return { state: upsert(state, idx, build(turn, existing, roleOf, false)) };
  }
  if (existing?.final) {
    const improves =
      turn.turn_is_formatted && (!existing.formatted || turn.transcript !== existing.text);
    if (!improves) return { state };
    const updated = build(turn, existing, roleOf, true);
    return { state: upsert(state, idx, updated), updated };
  }
  const finalized = build(turn, existing, roleOf, true);
  return { state: upsert(state, idx, finalized), finalized };
}

/**
 * Apply the end-of-session SpeakerRevision. PENDING turns adopt the revised label (that is new
 * information). Turns that already carried a live label keep it and record the proposal as
 * `revisedLabel`: on the synthetic two-voice recording the revision pass contradicted correct
 * live labels on five of eight turns, so it must not silently move evidence (docs/decisions.md).
 * `changed` lists the turns whose label actually changed.
 */
export function applyRevision(
  state: TranscriptState,
  revision: SpeakerRevision,
  roleOf: RoleOf,
): { state: TranscriptState; changed: number[] } {
  const changed: number[] = [];
  let turns = state.turns;
  for (const rev of revision.revisions) {
    const idx = turns.findIndex((t) => t.order === rev.turn_order);
    const existing = idx >= 0 ? turns[idx] : undefined;
    if (!existing) continue;
    const proposed = rev.speaker_label ?? undefined;
    const words = mergeWords(existing.words, rev.words);
    let next: StoredTurn;
    if (existing.pending && !isPending(proposed)) {
      next = {
        ...existing,
        speakerLabel: proposed,
        pending: false,
        role: roleOf(proposed),
        words,
        revised: true,
      };
      changed.push(rev.turn_order);
    } else {
      next = {
        ...existing,
        words,
        revised: true,
        revisedLabel:
          proposed && proposed !== existing.speakerLabel ? proposed : existing.revisedLabel,
      };
    }
    turns = replaceAt(turns, idx, next);
  }
  return { state: { turns }, changed };
}

/** After a swap or manual assignment: recompute every role from the labels. */
export function reassignRoles(state: TranscriptState, roleOf: RoleOf): TranscriptState {
  return {
    turns: state.turns.map((t) => ({ ...t, role: t.pending ? undefined : roleOf(t.speakerLabel) })),
  };
}

/** Mark a turn as Saakshi's own voice leaking into the microphone (see session/echo.ts). */
export function markEcho(state: TranscriptState, order: number): TranscriptState {
  return {
    turns: state.turns.map((t) => (t.order === order ? { ...t, echo: true, role: undefined } : t)),
  };
}

export function previousFinal(state: TranscriptState, order: number): StoredTurn | undefined {
  let best: StoredTurn | undefined;
  for (const t of state.turns) {
    if (t.order >= order) break;
    if (t.final && !t.echo) best = t;
  }
  return best;
}

export function finalTurns(state: TranscriptState): StoredTurn[] {
  return state.turns.filter((t) => t.final && !t.echo);
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- internals

function isPending(label: string | undefined): boolean {
  return label === undefined || label === "PENDING";
}

function build(
  turn: Turn,
  existing: StoredTurn | undefined,
  roleOf: RoleOf,
  final: boolean,
): StoredTurn {
  const label = turn.speaker_label ?? existing?.speakerLabel;
  const pending = final && isPending(label);
  const languageCode = turn.language_code ?? existing?.languageCode;
  const first = turn.words[0];
  const last = turn.words[turn.words.length - 1];
  return {
    order: turn.turn_order,
    text: turn.transcript,
    final,
    formatted: final && turn.turn_is_formatted,
    speakerLabel: label,
    role: isPending(label) ? undefined : roleOf(label),
    language: languageTag(turn.transcript, languageCode),
    languageCode,
    languageConfidence: turn.language_confidence ?? existing?.languageConfidence,
    startMs: first?.start ?? existing?.startMs ?? 0,
    endMs: last?.end ?? existing?.endMs ?? 0,
    words: turn.words,
    revised: existing?.revised ?? false,
    revisedLabel: existing?.revisedLabel,
    pending,
  };
}

function mergeWords(
  existing: TurnWord[],
  revised: SpeakerRevision["revisions"][number]["words"],
): TurnWord[] {
  if (revised.length === 0) return existing;
  return revised.map((w, i) => ({
    text: w.text,
    start: w.start,
    end: w.end,
    confidence: existing[i]?.confidence ?? 1,
    word_is_final: true,
    speaker: w.speaker,
  }));
}

function upsert(state: TranscriptState, idx: number, turn: StoredTurn): TranscriptState {
  if (idx >= 0) return { turns: replaceAt(state.turns, idx, turn) };
  const at = state.turns.findIndex((t) => t.order > turn.order);
  const turns =
    at === -1
      ? [...state.turns, turn]
      : [...state.turns.slice(0, at), turn, ...state.turns.slice(at)];
  return { turns };
}

function replaceAt<T>(list: T[], idx: number, item: T): T[] {
  const copy = list.slice();
  copy[idx] = item;
  return copy;
}
