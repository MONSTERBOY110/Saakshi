import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Locator } from "@playwright/test";

// Measures intervention latency over several passes of the two-voice WAV (trd.md section 14,
// Phase 2 task 8). The WAV loops, so each pass replays the planted "returns are guaranteed" line
// with fresh turn orders and produces one more measurement.
//   SAAKSHI_LIVE_E2E=1 SAAKSHI_FAKE_WAV=tests/fixtures/golden-draft.wav \
//   SAAKSHI_LATENCY_SAMPLES=10 pnpm exec playwright test tests/e2e/latency.live.spec.ts
test.describe("intervention latency (live AssemblyAI)", () => {
  test.skip(
    !process.env.SAAKSHI_LIVE_E2E || !process.env.SAAKSHI_FAKE_WAV,
    "set SAAKSHI_LIVE_E2E=1 and SAAKSHI_FAKE_WAV=tests/fixtures/golden-draft.wav",
  );

  test("p50 stays inside the 2.5 s budget", async ({ page }) => {
    const wanted = Number(process.env.SAAKSHI_LATENCY_SAMPLES ?? 10);
    // One pass of the WAV is about 80 s and yields one intervention.
    test.setTimeout(wanted * 95_000 + 120_000);

    const measurements: Array<Record<string, unknown>> = [];
    page.on("console", (m) => {
      const text = m.text();
      if (!text.includes("intervention.latency")) return;
      const json = /\{.*\}/.exec(text);
      if (json) {
        try {
          measurements.push(JSON.parse(json[0]));
        } catch {
          /* the drawer log format changed; the in-page counter below still holds */
        }
      }
    });

    await page.goto("/session");
    await Promise.all([page.request.get("/api/token/stt"), page.request.get("/api/token/agent")]);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByTestId("mouth-status")).toHaveText("ready", { timeout: 45_000 });
    await expect(page.getByTestId("phase")).toHaveText("observe", { timeout: 90_000 });

    // Acknowledge every intervention as it appears so the room returns to OBSERVE quickly.
    const badge = page.getByTestId("intervention-p50");
    const acknowledge = page.getByTestId("acknowledge");
    const deadline = Date.now() + wanted * 95_000;
    let seen = 0;
    let idleSince = Date.now();
    while (seen < wanted && Date.now() < deadline) {
      const appeared = await acknowledge
        .waitFor({ state: "visible", timeout: 100_000 })
        .then(() => true)
        .catch(() => false);
      if (appeared) {
        await acknowledge.click().catch(() => undefined);
        const now = await countFromBadge(badge);
        if (now > seen) {
          seen = now;
          idleSince = Date.now();
          console.log(`[latency] sample ${seen}: ${(await badge.textContent()) ?? ""}`);
        }
      }
      // The fake microphone loops the WAV; if nothing arrives for three minutes, stop early.
      if (Date.now() - idleSince > 180_000) break;
    }

    const text = (await badge.textContent()) ?? "";
    const p50 = Number(/p50 (\d+) ms/.exec(text)?.[1] ?? NaN);
    const samples = await page.evaluate(() => {
      const w = window as unknown as { __saakshi_latencies?: number[] };
      return w.__saakshi_latencies ?? [];
    });
    const report = {
      ran_at: new Date().toISOString(),
      badge: text,
      p50_ms: p50,
      samples: samples.length > 0 ? samples : measurements,
    };
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/latency-report.json", JSON.stringify(report, null, 2));
    console.log(`[latency] ${text} over ${seen} interventions`);

    expect(seen).toBeGreaterThan(0);
    expect(p50).toBeLessThanOrEqual(2500);

    await page.getByRole("button", { name: "Stop", exact: true }).click();
  });
});

async function countFromBadge(badge: Locator): Promise<number> {
  const text = (await badge.textContent().catch(() => "")) ?? "";
  return Number(/over (\d+)/.exec(text)?.[1] ?? 0);
}
