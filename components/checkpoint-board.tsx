"use client";

import { Bean, BeanHalf, CrossMark, EmptySquare, FlagMark, StarOrnament } from "@/components/marks";
import type { BoardState, CheckpointState, ViolationState } from "@/lib/session/board";
import { boardSummary } from "@/lib/session/board";
import type { SessionSetup } from "@/lib/session/keyterms";
import { formatClock } from "@/lib/session/transcript";

// The tabla. Every required disclosure is a named, numbered card, and it gets a bean the moment it
// is actually said. Nothing is cropped: the card carries its full label, and the quote that earned
// the bean sits under it with the clock time, so the eye walks from the claim to its evidence
// without a hover. Flags are the only red on the page.

type Props = { board: BoardState | null; setup: SessionSetup };

const FIELDS = ["bg-turquoise", "bg-sun", "bg-rose"];

export function CheckpointBoard({ board, setup }: Props) {
  if (!board) return null;
  const summary = boardSummary(board);
  const full = summary.met === summary.total && summary.open === 0;

  return (
    <section aria-label="Checkpoint board" className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="ribbon">
          <StarOrnament className="h-3 w-3" />
          The tabla
        </h2>
        <p className="num text-ink-soft" data-testid="board-summary">
          {summary.met} of {summary.total} disclosures made, {summary.open} open{" "}
          {summary.open === 1 ? "flag" : "flags"}
        </p>
      </div>

      {full && (
        <p className="anim-shout card-print-tight bg-sun font-display px-3 py-1.5 text-center text-sm tracking-[0.06em] uppercase">
          Full house. Every disclosure made.
        </p>
      )}

      <ol className="card-print bg-paper-deep grid grid-cols-2 gap-2 border-[3px] p-2 sm:grid-cols-4">
        {board.checkpoints.map((c, i) => (
          <CheckpointCard key={c.id} c={c} n={i + 1} field={FIELDS[i % FIELDS.length] as string} />
        ))}
      </ol>

      <div className="flex flex-col gap-2">
        {board.checkpoints
          .filter((c) => c.status !== "pending" && c.evidence)
          .slice(-2)
          .map((c) => (
            <Evidence key={c.id} c={c} setup={setup} />
          ))}
      </div>

      <h3 className="ribbon ribbon-quiet mt-1 self-start">Flags called</h3>
      {board.violations.length === 0 ? (
        <p className="text-ink-soft text-sm" data-testid="no-flags">
          No prohibited claim has been made.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {board.violations.map((v) => (
            <ViolationRow key={v.key} v={v} setup={setup} />
          ))}
        </ol>
      )}

      {board.beliefs.length > 0 && (
        <div className="rule-dashed text-ink-soft pt-2 text-xs">
          <p className="plate">To correct in the teach-back</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {board.beliefs.map((b) => (
              <li key={b.key}>
                {b.label} ({formatClock(b.evidence.startMs)}): &ldquo;{b.evidence.quote}&rdquo;
              </li>
            ))}
          </ul>
        </div>
      )}

      {board.notes.length > 0 && (
        <div className="rule-dashed text-ink-soft pt-2 text-xs" data-testid="analyzer-notes">
          <p className="plate">Analyzer notes, not evidence</p>
          <p className="mt-0.5">
            What the language model thought it heard. Nothing here ticks a card, calls a flag or is
            spoken; it is kept for a reviewer to check against the quotes.
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {board.notes.map((n) => (
              <li key={n.key} data-testid="analyzer-note" data-kind={n.kind} data-id={n.id}>
                {n.kind === "prohibited" ? "Claim?" : "Disclosure?"} {n.label} (
                {n.confidence.toFixed(2)}
                {n.evidence ? `, ${formatClock(n.evidence.startMs)}` : ""}): &ldquo;{n.quote}&rdquo;
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function CheckpointCard({ c, n, field }: { c: CheckpointState; n: number; field: string }) {
  const met = c.status !== "pending";
  const nudged = c.status === "met_after_nudge";
  return (
    <li
      data-testid="checkpoint"
      data-id={c.id}
      data-status={c.status}
      className={`border-ink relative flex aspect-3/4 flex-col justify-between border-2 p-1.5 ${met ? field : "bg-paper"}`}
      title={`${c.label}. ${c.citation.authority}, ${c.citation.instrument}.`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="num">{String(n).padStart(2, "0")}</span>
        {nudged && (
          <span className="num border-ink bg-paper rounded-sm border px-1 leading-tight">
            after nudge
          </span>
        )}
      </div>
      <span className="flex flex-1 items-center justify-center">
        {met ? (
          <Bean className="anim-bean h-9 w-9" title="Disclosed" />
        ) : (
          <EmptySquare className="h-7 w-7" title="Not said yet" />
        )}
      </span>
      <span className="plate text-center leading-[1.15] hyphens-auto">{c.shortLabel}</span>
    </li>
  );
}

/** The leader line from a marked card back to the words that earned it. */
function Evidence({ c, setup }: { c: CheckpointState; setup: SessionSetup }) {
  if (!c.evidence) return null;
  return (
    <p className="border-ink text-ink-soft border-l-2 pl-2 text-xs leading-snug">
      <span className="num">{formatClock(c.evidence.startMs)}</span>{" "}
      <span className="plate">{setup.advisorName}</span> &ldquo;{c.evidence.quote}&rdquo;
    </p>
  );
}

function ViolationRow({ v, setup }: { v: ViolationState; setup: SessionSetup }) {
  return (
    <li
      data-testid="violation"
      data-id={v.id}
      data-severity={v.severity}
      className="card-print-tight border-carnival bg-paper"
    >
      <div className="border-carnival bg-carnival flex flex-wrap items-center gap-2 border-b-2 px-2 py-1">
        <FlagMark className="h-4 w-4 shrink-0" />
        <span className="font-display text-sm text-[#fff8e8]">{v.label}</span>
        <span className="num border-ink bg-paper ml-auto rounded-sm border px-1">{v.severity}</span>
        <span className="num border-ink bg-paper rounded-sm border px-1">{v.status}</span>
      </div>
      <div className="flex flex-col gap-1 px-2 py-1.5 text-xs leading-snug">
        <p>
          <span className="num">{formatClock(v.evidence.startMs)}</span>{" "}
          <span className="plate">{setup.advisorName}</span> &ldquo;{v.evidence.quote}&rdquo;
        </p>
        <p className="text-ink-soft">Saakshi said: {v.correction}</p>
        <p className="text-ink-soft" title={v.citation.clause}>
          {v.citation.authority}, {v.citation.instrument}
        </p>
        <p className="num text-ink-soft" data-testid="latency-slot">
          {v.latencyMs !== undefined ? `answered in ${v.latencyMs} ms` : "no spoken intervention"}
        </p>
      </div>
    </li>
  );
}

/** Exported so the teach-back panel can mark answers with the same objects the tabla uses. */
export const TeachbackMarks = { Bean, BeanHalf, CrossMark };
