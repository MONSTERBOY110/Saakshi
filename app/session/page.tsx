"use client";

import { useEffect, useMemo, useState } from "react";
import { AgentBar } from "@/components/agent-bar";
import { CalibrationBanner } from "@/components/calibration-banner";
import { CertificateCard } from "@/components/certificate-card";
import { CheckpointBoard } from "@/components/checkpoint-board";
import { DebugDrawer } from "@/components/debug-drawer";
import { InterventionBanner } from "@/components/intervention-banner";
import { JudgeSoloPanel } from "@/components/judge-solo-panel";
import { SetupForm } from "@/components/setup-form";
import { TablaPreview } from "@/components/tabla-preview";
import { TeachbackPanel } from "@/components/teachback-panel";
import { TranscriptPanel } from "@/components/transcript-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRoomController } from "@/lib/session/controller";
import { getPack } from "@/lib/rules/load";
import { isKeytermsMode } from "@/lib/session/keyterms";
import { rolesBound } from "@/lib/session/roles";
import { useRoomStore } from "@/lib/session/store";

export default function SessionPage() {
  const state = useRoomStore();
  const controller = getRoomController();
  const [term, setTerm] = useState("");
  const pack = useMemo(() => getPack(state.setup.packId), [state.setup.packId]);

  // ?keyterms=identity|full|none picks the recogniser vocabulary for this session. It exists for
  // the keyterms-integrity experiment (tests/e2e/keyterms.live.spec.ts); the deployment default is
  // identity terms only.
  useEffect(() => {
    const mode = new URLSearchParams(window.location.search).get("keyterms");
    if (isKeytermsMode(mode)) useRoomStore.getState().setSetup({ keytermsMode: mode });
  }, []);

  // A read-only view of the room for the live specs, so measurements come from the same state the
  // screen shows. Nothing here is audio; the events kept are the billing and rule summaries.
  useEffect(() => {
    const w = window as unknown as { __saakshi_room?: unknown };
    w.__saakshi_room = {
      phase: state.phase,
      setup: state.setup,
      roles: state.roles,
      status: state.status,
      board: state.board,
      turns: state.transcript.turns
        .filter((t) => t.final)
        .map((t) => ({
          order: t.order,
          role: t.role,
          speakerLabel: t.speakerLabel,
          text: t.text,
          startMs: t.startMs,
          endMs: t.endMs,
          echo: t.echo,
          language: t.language,
        })),
      analyzer: state.analyzer,
      events: state.events.filter((e) =>
        ["Termination", "session.ended", "analyze.result", "rules", "UpdateConfiguration"].includes(
          e.type,
        ),
      ),
    };
  }, [state]);
  const inSetup = state.phase === "SETUP";
  const done = state.phase === "DONE";
  const labelsSeen = useMemo(
    () =>
      Array.from(
        new Set(
          state.transcript.turns
            .filter((t) => t.final && !t.pending && t.speakerLabel)
            .map((t) => t.speakerLabel as string),
        ),
      ),
    [state.transcript.turns],
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-[92rem] flex-col gap-4 px-5 py-5 sm:px-7">
      <header className="border-ink flex flex-wrap items-center justify-between gap-3 border-b-2 pb-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="shout text-2xl">SAAKSHI</span>
          <p className="text-ink-soft text-sm">
            {state.setup.productName} sale, {state.setup.advisorName} with{" "}
            {state.setup.customerName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="phase"
            className={`num border-ink rounded-sm border-2 px-2 py-1 ${state.error ? "bg-carnival text-[#fff8e8]" : "bg-sun"}`}
          >
            {state.phase.toLowerCase()}
          </span>
          {!inSetup && !done && (
            <>
              <Button
                variant="secondary"
                onClick={() => controller.verify("button")}
                disabled={state.phase !== "OBSERVE"}
                data-testid="verify"
                title="End the pitch and read any missing disclosures"
              >
                Saakshi, verify
              </Button>
              <Button
                variant="secondary"
                onClick={() => controller.finishTeachback()}
                disabled={state.phase !== "TEACHBACK"}
                data-testid="finish-teachback"
                title="End the teach-back and issue the consent certificate"
              >
                Finish teach-back
              </Button>
              <Button variant="destructive" onClick={() => void controller.stop()}>
                Stop
              </Button>
            </>
          )}
          {done && (
            <Button variant="outline" onClick={() => controller.reset()}>
              New session
            </Button>
          )}
        </div>
      </header>

      {state.error && (
        <p
          role="alert"
          className="card-print border-carnival bg-carnival p-3 text-sm text-[#fff8e8]"
        >
          {state.error}
        </p>
      )}

      {inSetup ? (
        <div className="grid items-start gap-8 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
          <SetupForm
            setup={state.setup}
            onChange={(patch) => state.setSetup(patch)}
            onStart={() => void controller.start(state.setup)}
            starting={false}
          />
          <figure className="flex flex-col items-center gap-3">
            <figcaption className="ribbon ribbon-quiet">
              What this pack tracks, all of it
            </figcaption>
            <TablaPreview pack={pack} />
            <figcaption className="text-ink-soft max-w-[46ch] text-center text-xs">
              Every card gets a bean the moment that disclosure is actually made, with the quote and
              the clock time that prove it. Anything still empty when the pitch ends is what Saakshi
              reads back out loud.
            </figcaption>
          </figure>
        </div>
      ) : (
        <>
          <CalibrationBanner
            roles={state.roles}
            setup={state.setup}
            labelsSeen={labelsSeen}
            calibrating={state.phase === "CALIBRATE" || !rolesBound(state.roles)}
            onSwap={() => controller.swapRoles()}
            onAssign={(role, label) => controller.assignRole(role, label)}
          />
          <InterventionBanner
            intervention={state.intervention}
            nudge={state.nudge}
            onAcknowledge={() => controller.acknowledge()}
          />
          <div className="grid min-h-[50vh] gap-4 lg:grid-cols-5">
            <div className="max-h-[60vh] lg:col-span-3">
              <TranscriptPanel turns={state.transcript.turns} setup={state.setup} />
            </div>
            <div className="flex flex-col gap-4 lg:col-span-2">
              <JudgeSoloPanel
                judgeSolo={state.judgeSolo}
                script={pack.demo_script}
                hints={pack.customer_hints}
                phase={state.phase}
                customerName={state.setup.customerName}
                onNext={() => controller.nextDemoLine()}
              />
              <CheckpointBoard board={state.board} setup={state.setup} />
              <TeachbackPanel teachback={state.teachback} setup={state.setup} />
              <CertificateCard certificate={state.certificate} />
            </div>
          </div>
          <AgentBar
            status={state.status}
            captions={state.captions}
            latenciesMs={state.latenciesMs}
            interventionLatenciesMs={state.interventionLatenciesMs}
            interventionTotalMs={state.interventionTotalMs}
            gaps={state.gaps}
            analyzer={state.analyzer}
          />
          <div className="flex flex-wrap items-center gap-2">
            <DebugDrawer events={state.events} onExport={() => controller.exportFixtures()} />
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const terms = term
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean);
                if (terms.length) controller.addKeyterms(terms);
                setTerm("");
              }}
            >
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Add a product term mid-session"
                className="w-64"
                aria-label="Add a product term"
              />
              <Button type="submit" variant="outline" size="sm" disabled={!term.trim() || done}>
                Add term
              </Button>
            </form>
          </div>
        </>
      )}
    </main>
  );
}
