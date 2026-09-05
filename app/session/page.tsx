"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { DebugDrawer } from "@/components/debug-drawer";
import { SpikeControls } from "@/components/spike-controls";
import { median } from "@/lib/spike/session-controller";
import { useDualSession } from "@/lib/spike/use-dual-session";

// Phase 0 spike room: one mic feeding both AssemblyAI sockets, with the controls for S1-S5 and S8.
export default function SessionPage() {
  const { state, controller } = useDualSession();
  const live = state.phase === "live";
  const busy = state.phase === "starting" || state.phase === "stopping";
  const last = state.latenciesMs.at(-1);
  const p50 = median(state.latenciesMs);
  const hb = state.ears.heartbeat;
  const drift = hb ? Math.round(((hb.audioMs - hb.wallMs) / Math.max(hb.wallMs, 1)) * 100) : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-5 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Session room</h1>
          <p className="text-muted-foreground text-sm">
            Phase 0 spike: Ears and Mouth from one mic.
          </p>
        </div>
        <Badge data-testid="phase" variant={state.phase === "error" ? "destructive" : "secondary"}>
          {state.phase}
        </Badge>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Chip
          testId="mic-status"
          label="Mic"
          value={state.micRate ? `${state.micRate} Hz` : "off"}
        />
        <Chip
          testId="ears-status"
          label="Ears (Streaming STT)"
          value={state.ears.status}
          detail={[
            state.ears.sessionId ? `id ${state.ears.sessionId.slice(0, 8)}` : null,
            hb
              ? `${hb.audioMs} ms audio / ${hb.wallMs} ms wall (${drift}% drift, rtf ${hb.realtimeFactor.toFixed(2)})`
              : null,
            state.ears.closeCode ? `closed ${state.ears.closeCode}` : null,
          ]}
        />
        <Chip
          testId="mouth-status"
          label="Mouth (Voice Agent)"
          value={state.mouth.ready ? "ready" : state.mouth.status}
          detail={[
            state.mouth.sessionId ? `id ${state.mouth.sessionId.slice(0, 12)}` : null,
            state.mouth.lastError ?? null,
            state.mouth.closeCode ? `closed ${state.mouth.closeCode}` : null,
          ]}
          tone={state.mouth.lastError ? "error" : "normal"}
        />
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void controller.start()} disabled={live || busy}>
          Start
        </Button>
        <Button
          variant="destructive"
          onClick={() => void controller.stop()}
          disabled={!live && state.phase !== "error"}
        >
          Stop
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={state.micToMouth}
            onCheckedChange={(on) => controller.setMicToMouth(on)}
          />
          Mic to Mouth
        </label>
        <span className="text-muted-foreground font-mono text-xs">
          frames ears {state.frames.ears} / mouth {state.frames.mouth} / dropped before ready{" "}
          {state.frames.droppedBeforeReady}
        </span>
        <Badge variant="outline">
          latency {last === undefined ? "n/a" : `${last} ms`}
          {p50 !== null ? `, p50 ${p50} ms over ${state.latenciesMs.length}` : ""}
        </Badge>
      </section>

      {state.error && (
        <p
          role="alert"
          className="text-destructive border-destructive/40 rounded-md border p-3 text-sm"
        >
          {state.error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Agent captions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="min-h-6 italic" aria-live="polite">
            {state.captions.live || <span className="text-muted-foreground">(silent)</span>}
          </p>
          <ul className="text-muted-foreground flex flex-col gap-1">
            {state.captions.history.slice(-4).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <p className="border-t pt-2">
            <span className="text-muted-foreground">You (agent STT): </span>
            {state.userTranscript || <span className="text-muted-foreground">nothing yet</span>}
          </p>
        </CardContent>
      </Card>

      <SpikeControls
        disabled={!live}
        verbatim={state.verbatim}
        onReplyNow={(t) => controller.replyNow(t)}
        onInjectFact={(t) => controller.injectFact(t)}
        onForceEndpoint={() => controller.forceEndpoint()}
        onUpdateKeyterms={(terms) => controller.updateKeyterms(terms)}
        onVerbatimTrial={(n) => void controller.verbatimTrial(n)}
      />

      <div>
        <DebugDrawer events={state.events} onExport={() => controller.exportFixtures()} />
      </div>
    </main>
  );
}

function Chip({
  label,
  value,
  detail = [],
  tone = "normal",
  testId,
}: {
  label: string;
  value: string;
  detail?: Array<string | null>;
  tone?: "normal" | "error";
  testId?: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-muted-foreground text-xs uppercase">{label}</p>
      <p
        data-testid={testId}
        className={tone === "error" ? "text-destructive font-medium" : "font-medium"}
      >
        {value}
      </p>
      {detail.filter(Boolean).map((d) => (
        <p key={d} className="text-muted-foreground font-mono text-xs break-all">
          {d}
        </p>
      ))}
    </div>
  );
}
