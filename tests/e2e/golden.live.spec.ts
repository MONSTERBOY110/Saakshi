import { expect, test } from "@playwright/test";

// Golden path v1 (Phase 1): the two-voice WAV plays through the fake microphone into the room.
// Calibration binds Rahul and Mrs. Sharma by name, the transcript fills with roles, the board ticks
// the disclosures and flags the planted "returns are guaranteed" line. Needs live AssemblyAI:
//   SAAKSHI_LIVE_E2E=1 SAAKSHI_FAKE_WAV=tests/fixtures/golden-draft.wav pnpm exec playwright test tests/e2e/golden.live.spec.ts
test.describe("golden path v1 (live AssemblyAI, two-voice WAV)", () => {
  test.skip(
    !process.env.SAAKSHI_LIVE_E2E || !process.env.SAAKSHI_FAKE_WAV,
    "set SAAKSHI_LIVE_E2E=1 and SAAKSHI_FAKE_WAV=tests/fixtures/golden-draft.wav",
  );

  test("roles bind by name, six or more checkpoints tick, guaranteed returns is flagged", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto("/session");
    // Warm the token routes: in dev they compile on first hit and can take 10 s or more.
    await Promise.all([page.request.get("/api/token/stt"), page.request.get("/api/token/agent")]);
    await expect(page.getByLabel("Advisor name")).toHaveValue("Rahul");
    await expect(page.getByLabel("Customer name")).toHaveValue("Mrs. Sharma");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    await expect(page.getByTestId("mic-status")).toHaveText("24000 Hz", { timeout: 30_000 });
    await expect(page.getByTestId("ears-status")).toHaveText("open", { timeout: 45_000 });
    await expect(page.getByTestId("mouth-status")).toHaveText("ready", { timeout: 45_000 });

    // Calibration binds both roles from the spoken names within the first pass of the script.
    await expect(page.getByTestId("phase")).toHaveText("observe", { timeout: 60_000 });
    await expect(page.getByText(/Roles bound/)).toBeVisible();

    // The 80 s script loops; six checkpoints and the critical flag must appear within one pass.
    await expect
      .poll(
        async () => {
          const text = (await page.getByTestId("board-summary").textContent()) ?? "";
          const m = /(\d+) of (\d+)/.exec(text);
          return m ? Number(m[1]) : 0;
        },
        { timeout: 120_000, intervals: [2_000] },
      )
      .toBeGreaterThanOrEqual(6);

    const flag = page.locator('[data-testid="violation"][data-id="guaranteed_returns"]').first();
    await expect(flag).toBeVisible({ timeout: 30_000 });
    await expect(flag).toHaveAttribute("data-severity", "critical");
    await expect(flag).toContainText(/guaranteed/i);

    const advisorTurns = page.locator(
      '[data-testid="turn"][data-role="advisor"][data-final="true"]',
    );
    const customerTurns = page.locator(
      '[data-testid="turn"][data-role="customer"][data-final="true"]',
    );
    expect(await advisorTurns.count()).toBeGreaterThanOrEqual(5);
    expect(await customerTurns.count()).toBeGreaterThanOrEqual(1);

    const summary = (await page.getByTestId("board-summary").textContent()) ?? "";
    console.log(
      `[golden] board: ${summary}; advisor turns ${await advisorTurns.count()}, customer turns ${await customerTurns.count()}`,
    );

    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByTestId("phase")).toHaveText("done", { timeout: 20_000 });
  });
});
