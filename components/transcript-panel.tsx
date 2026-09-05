"use client";

import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import type { SessionSetup } from "@/lib/session/keyterms";
import { formatClock, type StoredTurn } from "@/lib/session/transcript";

type Props = { turns: StoredTurn[]; setup: SessionSetup };

// Role is shown by colour and by a text label, so colour is never the only signal.
const ROLE_STYLE = {
  advisor: "border-l-sky-500 bg-sky-50 dark:bg-sky-950/40",
  customer: "border-l-emerald-500 bg-emerald-50 dark:bg-emerald-950/40",
  unknown: "border-l-neutral-300 bg-neutral-50 dark:bg-neutral-900/40",
} as const;

export function TranscriptPanel({ turns, setup }: Props) {
  const bottom = useRef<HTMLDivElement>(null);
  const lastText = turns[turns.length - 1]?.text;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns.length, lastText]);

  return (
    <section aria-label="Transcript" className="flex h-full flex-col gap-2">
      <h2 className="text-sm font-medium tracking-wide uppercase">Transcript</h2>
      <ol className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1" data-testid="transcript">
        {turns.length === 0 && <li className="text-muted-foreground text-sm">Nothing said yet.</li>}
        {turns.map((t) => {
          const who = t.role ?? "unknown";
          const name =
            t.role === "advisor"
              ? setup.advisorName
              : t.role === "customer"
                ? setup.customerName
                : t.pending
                  ? "Speaker (pending)"
                  : t.speakerLabel
                    ? `Speaker ${t.speakerLabel}`
                    : "Speaker";
          return (
            <li
              key={t.order}
              data-testid="turn"
              data-role={who}
              data-final={t.final}
              className={`rounded-md border-l-4 px-3 py-2 text-sm ${ROLE_STYLE[who]} ${t.final ? "" : "opacity-70"}`}
            >
              <div className="text-muted-foreground mb-0.5 flex flex-wrap items-center gap-2 font-mono text-xs">
                <span>{formatClock(t.startMs)}</span>
                <span className="text-foreground font-semibold">{name}</span>
                <Badge variant="outline">{t.language}</Badge>
                {!t.final && <span>partial</span>}
                {t.revised && (
                  <span
                    title={
                      t.revisedLabel ? `revision proposed speaker ${t.revisedLabel}` : "revised"
                    }
                  >
                    revised
                  </span>
                )}
              </div>
              <p className={t.final ? "" : "italic"}>{t.text}</p>
            </li>
          );
        })}
        <div ref={bottom} />
      </ol>
    </section>
  );
}
