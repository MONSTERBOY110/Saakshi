"use client";

import { CallerHorn, FlagMark } from "@/components/marks";
import { Button } from "@/components/ui/button";
import type { ActiveIntervention, NudgeState } from "@/lib/session/store";

// The caller raises the flag. This is the only carnival-red surface in the room, and it appears
// only when a prohibited claim has actually been made, so red never has to be read twice. The
// latency is the number the whole product is judged on, so it is set large and in the data face,
// with the honest total rather than the flattering half.

type Props = {
  intervention?: ActiveIntervention;
  nudge?: NudgeState;
  onAcknowledge: () => void;
};

export function InterventionBanner({ intervention, nudge, onAcknowledge }: Props) {
  if (intervention) {
    // The number this product is judged on is end of speech to first sound. When the audio clock
    // has not settled the total cannot be computed, and the reply time alone is the flattering half
    // of the measurement, so it is labelled as what it is rather than shown as the headline.
    const total = intervention.totalMs;
    const ms = total ?? intervention.latencyMs;
    return (
      <div
        role="alert"
        data-testid="intervention-banner"
        data-id={intervention.id}
        className="anim-called card-print border-ink bg-carnival flex flex-wrap items-stretch gap-0 border-[3px] p-0"
      >
        <div className="border-ink flex items-center gap-2 border-r-2 px-3 py-2">
          <FlagMark className="h-6 w-6 shrink-0" />
          <span className="num border-ink bg-paper rounded-sm border-2 px-1.5 py-0.5">
            {intervention.severity}
          </span>
        </div>

        <div className="min-w-0 flex-1 px-3 py-2 text-[#fff8e8]">
          <p className="plate">Saakshi called it: {intervention.label}</p>
          <p className="font-display mt-1 text-base leading-snug">
            &ldquo;{intervention.spokenText}&rdquo;
          </p>
          <p className="mt-1 text-xs opacity-90">
            heard &ldquo;{intervention.quote}&rdquo; · flagged by {intervention.source}
          </p>
        </div>

        <div className="border-ink bg-paper flex items-center gap-3 border-l-2 px-3 py-2">
          <div className="text-center">
            <span
              data-testid="intervention-latency"
              className="font-display tabular block text-xl leading-none"
              title="From the end of the advisor's speech to Saakshi's first sound, recogniser lag included"
            >
              {ms === undefined ? "measuring" : `${ms} ms`}
            </span>
            <span className="plate text-ink-soft">
              {total === undefined ? "reply only" : "to speak"}
            </span>
          </div>
          {intervention.acknowledged ? (
            <span
              className="num border-ink bg-sun rounded-sm border-2 px-1.5 py-0.5"
              data-testid="intervention-acknowledged"
            >
              acknowledged
            </span>
          ) : (
            <Button size="sm" onClick={onAcknowledge} data-testid="acknowledge">
              Acknowledge
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (nudge) {
    return (
      <div
        role="status"
        data-testid="nudge-banner"
        className="anim-called card-print bg-sun flex flex-wrap items-center gap-3 border-[3px] px-3 py-2"
      >
        <CallerHorn className="h-6 w-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="plate">Before we finish</p>
          <p className="font-display text-base leading-snug">&ldquo;{nudge.spokenText}&rdquo;</p>
        </div>
        {nudge.missing.length > 0 && (
          <span className="num border-ink bg-paper rounded-sm border-2 px-1.5 py-0.5">
            {nudge.missing.length} still unmarked
          </span>
        )}
      </div>
    );
  }

  return null;
}
