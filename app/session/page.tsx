"use client";

import { useMemo, useState } from "react";
import { AgentBar } from "@/components/agent-bar";
import { CalibrationBanner } from "@/components/calibration-banner";
import { CheckpointBoard } from "@/components/checkpoint-board";
import { DebugDrawer } from "@/components/debug-drawer";
import { InterventionBanner } from "@/components/intervention-banner";
import { SetupForm } from "@/components/setup-form";
import { TranscriptPanel } from "@/components/transcript-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRoomController } from "@/lib/session/controller";
import { rolesBound } from "@/lib/session/roles";
import { useRoomStore } from "@/lib/session/store";

export default function SessionPage() {
  const state = useRoomStore();
  const controller = getRoomController();
  const [term, setTerm] = useState("");
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
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Session room</h1>
          <p className="text-muted-foreground text-sm">
            {state.setup.productName} sale, {state.setup.advisorName} with{" "}
            {state.setup.customerName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge data-testid="phase" variant={state.error ? "destructive" : "secondary"}>
            {state.phase.toLowerCase()}
          </Badge>
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
          className="text-destructive border-destructive/40 rounded-md border p-3 text-sm"
        >
          {state.error}
        </p>
      )}

      {inSetup ? (
        <SetupForm
          setup={state.setup}
          onChange={(patch) => state.setSetup(patch)}
          onStart={() => void controller.start(state.setup)}
          starting={false}
        />
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
            <div className="lg:col-span-2">
              <CheckpointBoard board={state.board} setup={state.setup} />
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
