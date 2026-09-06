"use client";

import { Badge } from "@/components/ui/badge";
import { median } from "@/lib/session/stats";
import type { RoomState } from "@/lib/session/store";

type Props = Pick<
  RoomState,
  | "status"
  | "captions"
  | "latenciesMs"
  | "interventionLatenciesMs"
  | "interventionTotalMs"
  | "gaps"
  | "analyzer"
>;

export function AgentBar({
  status,
  captions,
  latenciesMs,
  interventionLatenciesMs,
  interventionTotalMs,
  gaps,
  analyzer,
}: Props) {
  // Prefer the end-of-speech figure; fall back to turn-received when the audio clock is unknown.
  const interventionSamples =
    interventionTotalMs.length > 0 ? interventionTotalMs : interventionLatenciesMs;
  const last = latenciesMs.at(-1);
  const p50 = median(latenciesMs);
  const hb = status.heartbeat;
  const drift = hb ? Math.round(((hb.audioMs - hb.wallMs) / Math.max(hb.wallMs, 1)) * 100) : null;
  return (
    <section
      aria-label="Saakshi"
      className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_auto]"
    >
      <div className="text-sm">
        <p className="text-muted-foreground text-xs uppercase">Saakshi says</p>
        <p className="min-h-6" aria-live="polite" data-testid="caption-live">
          {captions.live || (
            <span className="text-muted-foreground">
              {status.agentSpeaking ? "..." : "(silent)"}
            </span>
          )}
        </p>
        <ul className="text-muted-foreground text-xs">
          {captions.history.slice(-3).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-start gap-2 text-xs sm:flex-col sm:items-end">
        <Chip
          testId="mic-status"
          label="Mic"
          value={status.micRate ? `${status.micRate} Hz` : "off"}
        />
        <Chip
          testId="ears-status"
          label="Ears"
          value={status.ears}
          detail={hb ? `${(hb.audioMs / 1000).toFixed(0)} s audio, ${drift}% drift` : undefined}
        />
        <Chip
          testId="mouth-status"
          label="Mouth"
          value={status.mouthReady ? "ready" : status.mouth}
          detail={status.mouthError}
          tone={status.mouthError ? "error" : "normal"}
        />
        <Badge variant="outline">
          reply latency {last === undefined ? "n/a" : `${last} ms`}
          {p50 !== null ? `, p50 ${p50} ms` : ""}
        </Badge>
        {interventionSamples.length > 0 && (
          <Badge variant="outline" data-testid="intervention-p50">
            intervention p50 {median(interventionSamples)} ms over {interventionLatenciesMs.length}
          </Badge>
        )}
        <Chip
          testId="analyzer-status"
          label="Analyzer"
          value={analyzer.status}
          detail={
            analyzer.status === "ok"
              ? `${analyzer.model} ${analyzer.latencyMs} ms, ${analyzer.calls} calls`
              : analyzer.status === "skipped"
                ? `budget, ${analyzer.skipped} skipped`
                : analyzer.lastError
          }
          tone={analyzer.status === "error" ? "error" : "normal"}
        />
        {gaps.length > 0 && <Badge variant="destructive">{gaps.length} STT gap(s)</Badge>}
      </div>
    </section>
  );
}

function Chip({
  testId,
  label,
  value,
  detail,
  tone = "normal",
}: {
  testId: string;
  label: string;
  value: string;
  detail?: string;
  tone?: "normal" | "error";
}) {
  return (
    <span className="flex items-baseline gap-1.5 font-mono">
      <span className="text-muted-foreground">{label}</span>
      <span data-testid={testId} className={tone === "error" ? "text-destructive" : ""}>
        {value}
      </span>
      {detail && <span className="text-muted-foreground">{detail}</span>}
    </span>
  );
}
