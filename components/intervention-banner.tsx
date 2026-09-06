"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActiveIntervention, NudgeState } from "@/lib/session/store";

type Props = {
  intervention?: ActiveIntervention;
  nudge?: NudgeState;
  onAcknowledge: () => void;
};

export function InterventionBanner({ intervention, nudge, onAcknowledge }: Props) {
  if (intervention) {
    return (
      <div
        role="alert"
        data-testid="intervention-banner"
        data-id={intervention.id}
        className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-red-500 bg-red-50 px-4 py-3 dark:bg-red-950/50"
      >
        <Badge variant="destructive">{intervention.severity}</Badge>
        <span className="text-sm font-medium">Saakshi interrupted: {intervention.label}</span>
        <p className="w-full text-sm italic">&ldquo;{intervention.spokenText}&rdquo;</p>
        <span
          data-testid="intervention-latency"
          className="font-mono text-xs"
          title="From the end of the advisor speech to Saakshi's first sound, including recogniser lag"
        >
          {intervention.latencyMs === undefined
            ? "measuring..."
            : intervention.totalMs !== undefined
              ? `${intervention.totalMs} ms`
              : `${intervention.latencyMs} ms`}
        </span>
        <span className="text-muted-foreground text-xs">via {intervention.source}</span>
        <div className="ml-auto">
          {intervention.acknowledged ? (
            <Badge variant="secondary" data-testid="intervention-acknowledged">
              acknowledged
            </Badge>
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
        className="rounded-lg border border-amber-500 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/40"
      >
        <span className="font-medium">Missing-disclosure check.</span>{" "}
        <span className="italic">&ldquo;{nudge.spokenText}&rdquo;</span>
        {nudge.missing.length > 0 && (
          <span className="text-muted-foreground"> ({nudge.missing.length} outstanding)</span>
        )}
      </div>
    );
  }
  return null;
}
