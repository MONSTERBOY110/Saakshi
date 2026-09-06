"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CustomerHint, DemoLine } from "@/lib/rules/pack";
import type { JudgeSoloState } from "@/lib/session/judge-solo";
import type { Phase } from "@/lib/session/machine";

type Props = {
  judgeSolo: JudgeSoloState | undefined;
  script: DemoLine[];
  hints: CustomerHint[];
  phase: Phase;
  customerName: string;
  onNext: () => void;
};

/**
 * Judge-solo mode (prd.md P0-10). A judge running the demo alone hears the advisor from the
 * speakers and plays the customer. This panel is the only thing they need to look at: what the
 * advisor just said, what to say back, and a way to move on if they would rather not wait.
 */
export function JudgeSoloPanel({ judgeSolo, script, hints, phase, customerName, onNext }: Props) {
  if (!judgeSolo?.enabled) return null;
  const line = script[judgeSolo.index];
  const waiting = judgeSolo.status === "waiting";
  const current = currentHints(hints, judgeSolo, phase);

  return (
    <section
      aria-label="Judge-solo mode"
      className="card-print flex flex-col gap-2 p-3"
      data-testid="judge-solo-panel"
      data-status={judgeSolo.status}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium tracking-wide uppercase">You are {customerName}</h2>
        <Badge variant="outline" data-testid="judge-solo-status">
          {label(judgeSolo, script.length)}
        </Badge>
      </div>

      {line && (
        <p className="text-sm" data-testid="judge-solo-line">
          <span className="text-ink-soft">The advisor: </span>
          {line.text_display}
        </p>
      )}

      {current.length > 0 ? (
        <div className="flex flex-col gap-1.5" data-testid="judge-solo-hints">
          <p className="text-ink-soft text-xs">Your turn. Say something like:</p>
          <ul className="flex flex-col gap-1">
            {current.map((hint) => (
              <li key={hint.when + hint.text_en} className="text-sm">
                <span className="font-medium">{hint.text_hi ?? hint.text_en}</span>
                {hint.text_hi && <span className="text-ink-soft"> · {hint.text_en}</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        judgeSolo.status === "speaking" && (
          <p className="text-ink-soft text-xs">Listen. Your turn comes next.</p>
        )
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={onNext}
          disabled={!waiting}
          data-testid="judge-solo-next"
          title="Move the advisor on without waiting"
        >
          Next line
        </Button>
        {judgeSolo.status === "done" && (
          <span className="text-ink-soft text-xs">The advisor has finished his script.</span>
        )}
      </div>
    </section>
  );
}

function label(state: JudgeSoloState, total: number): string {
  if (state.status === "idle") return "waiting to start";
  if (state.status === "done") return "script finished";
  const position = `line ${Math.min(state.index + 1, total)} of ${total}`;
  return state.status === "speaking" ? `${position}, advisor speaking` : `${position}, your turn`;
}

/** The hints that apply right now: the teach-back set once it starts, otherwise the current line. */
function currentHints(hints: CustomerHint[], state: JudgeSoloState, phase: Phase): CustomerHint[] {
  if (phase === "TEACHBACK") return hints.filter((h) => h.when === "phase:TEACHBACK");
  if (state.status !== "waiting" || !state.lineId) return [];
  return hints.filter((h) => h.when === `after:${state.lineId}`);
}
