import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { getPack } from "@/lib/rules/load";

// Judge-solo mode against the live APIs (prd.md P0-10, FR-11). The fake microphone carries only
// Mrs. Sharma; the room itself plays the pre-rendered Rahul and mixes him into the Streaming STT
// stream. If diarization finds two speakers and the planted "returns are guaranteed" line is
// interrupted, then the mixing, the pacing and the gating all work.
//   SAAKSHI_LIVE_E2E=1 SAAKSHI_FAKE_WAV=tests/fixtures/judge-solo-customer.wav pnpm exec playwright test tests/e2e/judge-solo.live.spec.ts

test.describe("judge-solo mode (live AssemblyAI, synthetic advisor)", () => {
  test.skip(
    !process.env.SAAKSHI_LIVE_E2E || !process.env.SAAKSHI_FAKE_WAV,
    "set SAAKSHI_LIVE_E2E=1 and SAAKSHI_FAKE_WAV=tests/fixtures/judge-solo-customer.wav",
  );

  test("one person hears the advisor, plays the customer, and Saakshi still interrupts", async ({
    page,
  }) => {
    // Against a deployed URL the whole script runs over the network, so the planted claim can
    // arrive a minute later than it does locally.
    test.setTimeout(420_000);
    await page.goto("/session");
    await Promise.all([page.request.get("/api/token/stt"), page.request.get("/api/token/agent")]);
    // Judge-solo is the shipped default, which is the point: a judge opens the URL and starts.
    await expect(page.getByTestId("judge-solo-toggle")).toBeChecked();
    await page.getByRole("button", { name: "Start", exact: true }).click();

    await expect(page.getByTestId("ears-status")).toHaveText("open", { timeout: 45_000 });
    await expect(page.getByTestId("mouth-status")).toHaveText("ready", { timeout: 45_000 });

    // The panel is the judge's whole interface: who they are and what to say.
    const panel = page.getByTestId("judge-solo-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("You are Mrs. Sharma");

    // The synthetic advisor starts once Saakshi's greeting is out of the way.
    await expect
      .poll(async () => panel.getAttribute("data-status"), { timeout: 60_000, intervals: [1_000] })
      .not.toBe("idle");
    await expect(page.getByTestId("judge-solo-line")).toContainText("Rahul", { timeout: 30_000 });

    // Judge-solo starts watching as soon as the advisor is known, because the room is playing him.
    // The judge can stay silent and still see the board fill.
    await expect(page.getByTestId("phase")).toHaveText("observe", { timeout: 90_000 });

    // The advisor's own words, spoken by the recording, attributed to the advisor.
    await expect
      .poll(async () => advisorTurns(page), { timeout: 90_000, intervals: [2_000] })
      .toBeGreaterThanOrEqual(2);

    // The moment the whole demo exists for, driven entirely by pre-rendered audio. The scripted line
    // "Anytime, madam, and the returns are guaranteed, twelve percent" carries two prohibited
    // claims, and the recogniser does not always keep them in one turn, so whichever is heard first
    // is the one spoken over. The test is that a claim was caught out loud, not which one.
    const banner = page.getByTestId("intervention-banner");
    await expect(banner).toBeVisible({ timeout: 260_000 });
    const flagged = await banner.getAttribute("data-id");
    console.log(`[judge-solo] first claim called: ${flagged}`);
    // Any claim the pack defines is a pass: the point is that pre-rendered audio reached the
    // recogniser and produced a spoken correction. Which one comes first depends on how the
    // recogniser split the line, and the demo script's own line carries two of them. The id is
    // logged so a human can check it is the one the video needs.
    const known = getPack("insurance-ulip-in").prohibited.map((p) => p.id);
    expect(known, `${flagged} is not a claim this pack defines`).toContain(flagged);

    const latency = page.getByTestId("intervention-latency");
    await expect(latency).toHaveText(/^\d+ ms$/, { timeout: 20_000 });
    const latencyMs = Number((await latency.textContent())!.replace(/\D/g, ""));
    const summary = (await page.getByTestId("board-summary").textContent()) ?? "";
    const advisor = await advisorTurns(page);
    const customer = await customerTurns(page);
    console.log(
      `[judge-solo] latency ${latencyMs} ms; board ${summary.trim()}; ${advisor} advisor and ${customer} customer turns`,
    );
    // Deliberately not gated. Judge-solo now starts watching on the advisor alone, so a judge who
    // says nothing still sees the board fill and the claim called; whether this fixed recording's
    // lines happen to land in a gap is the fixture's luck, not the product's behaviour. The
    // customer path is covered by the two-voice golden run and by the unit tests.
    console.log(`[judge-solo] customer turns heard: ${customer}`);

    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      "test-results/judge-solo-report.json",
      JSON.stringify(
        { ran_at: new Date().toISOString(), latencyMs, summary: summary.trim(), advisor, customer },
        null,
        2,
      ),
    );

    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByTestId("phase")).toHaveText("done", { timeout: 20_000 });
  });
});

function advisorTurns(page: Page): Promise<number> {
  return page.locator('[data-testid="turn"][data-role="advisor"]').count();
}

function customerTurns(page: Page): Promise<number> {
  return page.locator('[data-testid="turn"][data-role="customer"]').count();
}
