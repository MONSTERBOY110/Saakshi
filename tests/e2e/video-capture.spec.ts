import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Screen capture for the submission video. Not part of any gate: it exists to produce raw 1080p
// footage plus a beat log, so the final cut can be assembled to the exact timeline published in
// docs/submission.md. Every beat records its offset from the start of its own recording, because
// Playwright starts the video when the context opens.
//   SAAKSHI_VIDEO=1 SAAKSHI_FAKE_WAV=tests/fixtures/judge-solo-customer.wav \
//     pnpm exec playwright test tests/e2e/video-capture.spec.ts --project=chromium

// Video forces its own worker, so this has to sit at file level rather than inside the describe.
test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: "on", size: { width: 1920, height: 1080 } },
});

test.describe("submission video capture", () => {
  test.skip(!process.env.SAAKSHI_VIDEO, "set SAAKSHI_VIDEO=1");

  test("landing", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.waitForTimeout(3_000);
    // A slow, even scroll to the foot of the page and back to the hero, so the cut can start
    // anywhere in it and still look deliberate.
    const height = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
    for (let i = 0; i <= 60; i++) {
      await page.evaluate((y) => window.scrollTo(0, y), (height * i) / 60);
      await page.waitForTimeout(330);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await page.waitForTimeout(4_000);
  });

  test("room", async ({ page }) => {
    test.setTimeout(600_000);
    const t0 = Date.now();
    const beats: { beat: string; at_ms: number }[] = [];
    const mark = (beat: string) => {
      const at = Date.now() - t0;
      beats.push({ beat, at_ms: at });
      console.log(`[video] ${String(at).padStart(6)} ms  ${beat}`);
    };

    await page.goto("/session");
    mark("session page open");
    await page.waitForTimeout(2_000);

    await expect(page.getByTestId("judge-solo-toggle")).toBeChecked();
    mark("judge-solo on, board empty");
    await page.waitForTimeout(4_000);

    await page.getByRole("button", { name: "Start", exact: true }).click();
    mark("start clicked");

    await expect(page.getByTestId("ears-status")).toHaveText("open", { timeout: 60_000 });
    await expect(page.getByTestId("mouth-status")).toHaveText("ready", { timeout: 60_000 });
    mark("both sockets live");

    await expect(page.getByTestId("phase")).toHaveText("observe", { timeout: 120_000 });
    mark("roles bound, observing");

    await expect
      .poll(() => page.locator('[data-testid="turn"]').count(), {
        timeout: 120_000,
        intervals: [1_000],
      })
      .toBeGreaterThanOrEqual(3);
    mark("transcript running");

    // The board's own summary line, which is also what the narration reads out.
    await expect
      .poll(
        async () => {
          const t = (await page.getByTestId("board-summary").textContent()) ?? "";
          return Number(/^(\d+) of/.exec(t.trim())?.[1] ?? 0);
        },
        { timeout: 180_000, intervals: [1_000] },
      )
      .toBeGreaterThanOrEqual(2);
    mark("cards taking beans");

    const banner = page.getByTestId("intervention-banner");
    await expect(banner).toBeVisible({ timeout: 300_000 });
    mark("INTERRUPTION");
    const latency = page.getByTestId("intervention-latency");
    await expect(latency).toHaveText(/\d+ ms/, { timeout: 25_000 });
    console.log(`[video] latency badge: ${(await latency.textContent())?.trim()}`);
    // Let the correction finish speaking and let a judge read the banner.
    await page.waitForTimeout(9_000);

    await page.getByTestId("acknowledge").click();
    mark("acknowledged");
    await page.waitForTimeout(3_000);

    await page.getByTestId("verify").click();
    await expect(page.getByTestId("phase")).toHaveText("nudge", { timeout: 30_000 });
    mark("NUDGE");
    await page.waitForTimeout(8_000);

    await expect(page.getByTestId("phase")).toHaveText("teachback", { timeout: 120_000 });
    mark("TEACH-BACK");
    const panel = page.getByTestId("teachback-panel");
    await expect
      .poll(() => panel.locator('[data-testid^="teachback-q-"]').count(), {
        timeout: 90_000,
        intervals: [1_000],
      })
      .toBeGreaterThanOrEqual(3);
    mark("questions on screen");
    await page.waitForTimeout(14_000);

    await page.getByTestId("finish-teachback").click();
    mark("finish teach-back");

    const card = page.getByTestId("certificate-card");
    await expect(card).toBeVisible({ timeout: 90_000 });
    mark("CERTIFICATE");
    const certId = ((await page.getByTestId("certificate-id").textContent()) ?? "").trim();
    const certHash = ((await page.getByTestId("certificate-hash").textContent()) ?? "").trim();
    console.log(`[video] certificate ${certId} ${certHash}`);
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(9_000);
    mark("end of room take");

    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      "test-results/video-beats.json",
      JSON.stringify({ certId, certHash, beats }, null, 2),
    );
  });

  test("proof", async ({ page }) => {
    test.setTimeout(180_000);
    const t0 = Date.now();
    const mark = (b: string) => console.log(`[video] ${String(Date.now() - t0).padStart(6)} ms  ${b}`);

    // Uses whatever certificate the room take stored. Falls back to the demo record so this test
    // still produces usable footage when run on its own.
    let id = process.env.SAAKSHI_CERT_ID ?? "";
    if (!id) {
      const res = await page.request.get("/api/certificate");
      if (res.ok()) id = ((await res.json()) as { id?: string }).id ?? "";
    }
    test.skip(!id, "no certificate id; run the room take first or set SAAKSHI_CERT_ID");

    await page.goto(`/verify/${id}`);
    await page.waitForTimeout(3_000);
    mark("verify page open");
    await scrollThrough(page, 24);
    mark("VALID read in full");
    await page.waitForTimeout(3_000);

    await page.goto(`/verify/${id}?tamper=quote`);
    await page.waitForTimeout(3_000);
    mark("tampered copy open");
    await scrollThrough(page, 20);
    mark("TAMPERED read in full");
    await page.waitForTimeout(3_000);
  });

  test("metrics", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/metrics");
    await page.waitForTimeout(3_000);
    await scrollThrough(page, 40);
    await page.waitForTimeout(3_000);
  });
});

/** An even scroll to the bottom in `steps` beats, so the cut can be trimmed anywhere. */
async function scrollThrough(page: Page, steps: number) {
  const height = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
  if (height <= 0) {
    await page.waitForTimeout(steps * 400);
    return;
  }
  for (let i = 0; i <= steps; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), (height * i) / steps);
    await page.waitForTimeout(400);
  }
}
