"use client";

import { useEffect, useRef } from "react";
import { StarOrnament } from "@/components/marks";
import type { SessionSetup } from "@/lib/session/keyterms";
import { formatClock, type StoredTurn } from "@/lib/session/transcript";

// The score sheet. Everything the room said, in order, ruled like a register so two people can read
// it across a desk. Who spoke is carried three ways at once: a name in spaced caps, a coloured
// field down the left edge, and the field's own hue behind the row, so losing the colour loses
// nothing. Turns still being heard are set in italic and say so.

type Props = { turns: StoredTurn[]; setup: SessionSetup };

const ROLE_FIELD = {
  advisor: "bg-turquoise",
  customer: "bg-rose",
  unknown: "bg-paper-deep",
} as const;

const ROLE_ROW = {
  advisor: "bg-[color-mix(in_srgb,var(--turquoise)_9%,var(--paper))]",
  customer: "bg-[color-mix(in_srgb,var(--rose)_10%,var(--paper))]",
  unknown: "bg-paper",
} as const;

export function TranscriptPanel({ turns, setup }: Props) {
  const bottom = useRef<HTMLDivElement>(null);
  const lastText = turns[turns.length - 1]?.text;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns.length, lastText]);

  return (
    <section aria-label="Transcript" className="flex h-full flex-col gap-2">
      <h2 className="ribbon ribbon-quiet self-start">
        <StarOrnament className="h-3 w-3" />
        What was said
      </h2>
      <ol
        className="card-print bg-paper flex flex-1 flex-col overflow-y-auto border-[3px]"
        data-testid="transcript"
      >
        {turns.length === 0 && (
          <li className="text-ink-soft px-3 py-6 text-center text-sm">
            Nothing said yet. Saakshi is listening.
          </li>
        )}
        {turns.map((t) => {
          const who = t.role ?? "unknown";
          const name =
            t.role === "advisor"
              ? setup.advisorName
              : t.role === "customer"
                ? setup.customerName
                : t.pending
                  ? "Speaker pending"
                  : t.speakerLabel
                    ? `Speaker ${t.speakerLabel}`
                    : "Speaker";
          return (
            <li
              key={t.order}
              data-testid="turn"
              data-role={who}
              data-final={t.final}
              className={`flex gap-0 border-b-2 border-dashed border-[color-mix(in_srgb,var(--ink)_25%,transparent)] last:border-b-0 ${ROLE_ROW[who]}`}
            >
              <span
                aria-hidden
                className={`border-ink w-2 shrink-0 border-r-2 ${ROLE_FIELD[who]}`}
              />
              <div className="min-w-0 flex-1 px-3 py-2">
                <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <time className="num text-ink-soft">{formatClock(t.startMs)}</time>
                  <span className="plate">{name}</span>
                  <span className="num border-ink bg-paper rounded-sm border px-1 leading-tight">
                    {t.language}
                  </span>
                  {!t.final && <span className="num text-ink-soft">still speaking</span>}
                  {t.revised && (
                    <span
                      className="num text-ink-soft"
                      title={
                        t.revisedLabel ? `revision proposed speaker ${t.revisedLabel}` : "revised"
                      }
                    >
                      revised
                    </span>
                  )}
                </div>
                <p className={`text-sm leading-relaxed ${t.final ? "" : "text-ink-soft italic"}`}>
                  {t.text}
                </p>
              </div>
            </li>
          );
        })}
        <div ref={bottom} />
      </ol>
    </section>
  );
}
