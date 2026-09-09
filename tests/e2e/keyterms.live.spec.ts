import { mkdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getPack } from "@/lib/rules/load";
import { buildKeyterms, DEFAULT_SETUP, isKeytermsMode } from "@/lib/session/keyterms";

// Keyterms integrity experiment (docs/decisions.md 2026-09-09; docs/plans/2026-09-09-week2-improvements.md
// item 4). The recogniser's transcript is the evidence the rule engine judges. If the recogniser is
// biased toward the very phrases the rules listen for, a mishearing can snap to the answer key and
// the certificate attests to a disclosure nobody made. This spec plays a fixed WAV through the fake
// microphone under one keyterms mode and records what the board ticked, what it flagged, and what
// the recogniser heard, so the three modes can be compared on identical audio.
//
//   SAAKSHI_LIVE_E2E=1 SAAKSHI_KEYTERMS_MODE=identity SAAKSHI_FAKE_WAV=tests/fixtures/omitted-draft.wav \
//     pnpm exec playwright test tests/e2e/keyterms.live.spec.ts
//
// With omitted-draft.wav the advisor makes exactly four disclosures (premium and term, policy term,
// market risk, lock-in) and no prohibited claim; the other four cards must stay empty and no flag
// may be called. With golden-draft.wav the question is the opposite one: how much recall the
// identity-only vocabulary gives up against the full vocabulary that was measured before.
//
// It also records the billed seconds both AssemblyAI sessions report at close, so the cost of the
// session can be computed from list prices (eval/measurements.json).

const MODE = process.env.SAAKSHI_KEYTERMS_MODE ?? "identity";
const OBSERVE_MS = Number(process.env.SAAKSHI_OBSERVE_MS ?? 80_000);
const WAV = process.env.SAAKSHI_FAKE_WAV ?? "";

// AssemblyAI list prices on 2026-09-09 (assemblyai.com/pricing): Streaming STT $0.45/h plus
// speaker labels $0.12/h, prompting and keyterms $0.05/h, voice focus $0.10/h; Voice Agent API
// $4.50/h. Billing is per second of open socket, which is what Termination and session.ended report.
const STT_USD_PER_HOUR = 0.45 + 0.12 + 0.05 + 0.1;
const AGENT_USD_PER_HOUR = 4.5;

type RoomSnapshot = {
  phase: string;
  setup: { keytermsMode?: string; packId: string };
  roles: { advisor?: string; customer?: string };
  board: {
    checkpoints: Array<{
      id: string;
      status: string;
      evidence?: { quote: string; turnOrder: number; startMs: number };
    }>;
    violations: Array<{
      id: string;
      status: string;
      source: string;
      latencyMs?: number;
      windowed: boolean;
      evidence: { quote: string; turnOrder: number };
    }>;
    beliefs: Array<{ id: string }>;
  } | null;
  turns: Array<{
    order: number;
    role?: string;
    speakerLabel?: string;
    text: string;
    startMs: number;
    endMs: number;
    echo?: boolean;
    language: string;
  }>;
  analyzer: { calls: number; skipped: number; model?: string };
  events: Array<{ type: string; payload: unknown; t: number }>;
};

test.describe("keyterms integrity (live AssemblyAI, fixed WAV, one mode per run)", () => {
  test.skip(
    !process.env.SAAKSHI_LIVE_E2E || !WAV || !isKeytermsMode(MODE),
    "set SAAKSHI_LIVE_E2E=1, SAAKSHI_FAKE_WAV=<wav> and SAAKSHI_KEYTERMS_MODE=identity|full|none",
  );

  test(`mode ${MODE}: what the board ticks on ${basename(WAV)}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto(`/session?keyterms=${MODE}`);
    await Promise.all([page.request.get("/api/token/stt"), page.request.get("/api/token/agent")]);
    await expect(page.getByTestId("keyterms-mode")).toContainText(MODE);
    // The fixture WAV carries both voices, so the synthetic advisor must stay off.
    await page.getByTestId("judge-solo-toggle").uncheck();
    await page.getByRole("button", { name: "Start", exact: true }).click();

    await expect(page.getByTestId("mic-status")).toHaveText("24000 Hz", { timeout: 30_000 });
    await expect(page.getByTestId("ears-status")).toHaveText("open", { timeout: 45_000 });
    await expect(page.getByTestId("mouth-status")).toHaveText("ready", { timeout: 45_000 });
    await expect(page.getByTestId("phase")).toHaveText("observe", { timeout: 90_000 });

    // One full pass of the recording plus a margin; the WAV loops, so a longer window only repeats it.
    await page.waitForTimeout(OBSERVE_MS);
    const observed = await snapshot(page);
    expect(observed.setup.keytermsMode).toBe(MODE);

    // Stop cleanly so both sockets report their billed duration. The phase flips to DONE before
    // Terminate and session.end have been answered, so wait for both closing events, not the phase.
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByTestId("phase")).toHaveText("done", { timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const s = await snapshot(page);
          const types = new Set(s.events.map((e) => e.type));
          return types.has("Termination") && types.has("session.ended");
        },
        { timeout: 20_000, intervals: [500] },
      )
      .toBe(true);
    const closed = await snapshot(page);

    const pack = getPack(observed.setup.packId);
    const sent = buildKeyterms(
      { ...DEFAULT_SETUP, packId: pack.id, keytermsMode: MODE as "identity" | "full" | "none" },
      pack,
    );
    const met = (observed.board?.checkpoints ?? []).filter((c) => c.status !== "pending");
    const flags = observed.board?.violations ?? [];
    const advisorTurns = observed.turns.filter((t) => t.role === "advisor" && !t.echo);

    const billing = billedSeconds(closed.events);
    const costUsd =
      (billing.sttSeconds / 3600) * STT_USD_PER_HOUR +
      (billing.agentSeconds / 3600) * AGENT_USD_PER_HOUR;

    const report = {
      ran_at: new Date().toISOString(),
      mode: MODE,
      wav: basename(WAV),
      observe_ms: OBSERVE_MS,
      keyterms_sent: sent,
      roles: observed.roles,
      finalized_turns: observed.turns.length,
      advisor_turns: advisorTurns.length,
      met: met.map((c) => ({
        id: c.id,
        status: c.status,
        quote: c.evidence?.quote,
        at_ms: c.evidence?.startMs,
      })),
      met_ids: met.map((c) => c.id).sort(),
      flags: flags.map((v) => ({
        id: v.id,
        status: v.status,
        source: v.source,
        windowed: v.windowed,
        turn: v.evidence.turnOrder,
        spoken_latency_ms: v.latencyMs,
        quote: v.evidence.quote,
      })),
      beliefs: observed.board?.beliefs.map((b) => b.id) ?? [],
      analyzer: observed.analyzer,
      heard: observed.turns
        .filter((t) => !t.echo)
        .map((t) => `${t.order} ${t.role ?? "?"} ${t.language} ${t.text}`),
      billing: {
        ...billing,
        stt_usd_per_hour: STT_USD_PER_HOUR,
        agent_usd_per_hour: AGENT_USD_PER_HOUR,
        cost_usd: Number(costUsd.toFixed(4)),
      },
    };
    // Playwright empties test-results/ at the start of every run, and the point of these reports is
    // to compare runs, so they live beside the other evidence the metrics page reads.
    mkdirSync("eval/keyterms", { recursive: true });
    const file = `eval/keyterms/${MODE}-${basename(WAV, ".wav")}.json`;
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(
      `[keyterms ${MODE}] ${basename(WAV)}: met ${report.met_ids.join(",") || "none"}; flags ${
        flags.map((f) => f.id).join(",") || "none"
      }; advisor turns ${advisorTurns.length}; stt ${billing.sttSeconds}s agent ${
        billing.agentSeconds
      }s cost $${costUsd.toFixed(3)}; report ${file}`,
    );
    for (const line of report.heard) console.log(`[keyterms ${MODE}]   heard: ${line}`);

    // The run is a measurement, not a gate, except for the two things that would make it worthless.
    expect(observed.roles.advisor, "the advisor was never bound").toBeTruthy();
    expect(advisorTurns.length, "no advisor speech reached the board").toBeGreaterThan(0);
  });
});

async function snapshot(page: Page): Promise<RoomSnapshot> {
  return page.evaluate(
    () => (window as unknown as { __saakshi_room: RoomSnapshot }).__saakshi_room,
  );
}

function billedSeconds(events: RoomSnapshot["events"]): {
  sttSeconds: number;
  agentSeconds: number;
} {
  let sttSeconds = 0;
  let agentSeconds = 0;
  for (const e of events) {
    const p = e.payload as Record<string, unknown> | null;
    if (!p) continue;
    if (e.type === "Termination") {
      const t = p.termination as { session_duration_seconds?: number } | undefined;
      if (typeof t?.session_duration_seconds === "number") sttSeconds += t.session_duration_seconds;
    }
    if (e.type === "session.ended" && typeof p.sessionDurationSeconds === "number") {
      agentSeconds += p.sessionDurationSeconds;
    }
  }
  return { sttSeconds, agentSeconds };
}
