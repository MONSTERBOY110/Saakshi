import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Golden path v3 (Phase 3): the two-voice WAV plays through the fake microphone into the room.
// Calibration binds Rahul and Mrs. Sharma by name, the board ticks the disclosures, Saakshi
// interrupts the planted "returns are guaranteed" line, the nudge reads what is still missing, the
// teach-back loads its questions, and the session ends in a stored certificate whose verify page
// reads VALID and, with one character altered, TAMPERED.
// Needs live AssemblyAI:
//   SAAKSHI_LIVE_E2E=1 SAAKSHI_FAKE_WAV=tests/fixtures/golden-draft.wav pnpm exec playwright test tests/e2e/golden.live.spec.ts
// A single intervention only has to be obviously prompt; the 2500 ms budget from prd.md section 7
// is judged over ten samples in tests/e2e/latency.live.spec.ts.
const SANITY_CEILING_MS = 8000;

test.describe("golden path v3 (live AssemblyAI, two-voice WAV)", () => {
  test.skip(
    !process.env.SAAKSHI_LIVE_E2E || !process.env.SAAKSHI_FAKE_WAV,
    "set SAAKSHI_LIVE_E2E=1 and SAAKSHI_FAKE_WAV=tests/fixtures/golden-draft.wav",
  );

  test("the room runs the pitch, interrupts, nudges, teaches back and issues a certificate that verifies", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.goto("/session");
    // Warm the token routes: in dev they compile on first hit and can take 10 s or more.
    await Promise.all([page.request.get("/api/token/stt"), page.request.get("/api/token/agent")]);
    await expect(page.getByLabel("Advisor name")).toHaveValue("Rahul");
    // The fixture WAV already carries both voices, so the synthetic advisor must stay off.
    await page.getByTestId("judge-solo-toggle").uncheck();
    await page.getByRole("button", { name: "Start", exact: true }).click();

    await expect(page.getByTestId("mic-status")).toHaveText("24000 Hz", { timeout: 30_000 });
    await expect(page.getByTestId("ears-status")).toHaveText("open", { timeout: 45_000 });
    await expect(page.getByTestId("mouth-status")).toHaveText("ready", { timeout: 45_000 });

    // Calibration binds both roles from the spoken names within the first pass of the script.
    await expect(page.getByTestId("phase")).toHaveText("observe", { timeout: 60_000 });
    await expect(page.getByText(/Roles bound/)).toBeVisible();

    // The interruption: the WAV says "the returns are guaranteed, twelve percent".
    const banner = page.getByTestId("intervention-banner");
    await expect(banner).toBeVisible({ timeout: 120_000 });
    await expect(banner).toHaveAttribute("data-id", "guaranteed_returns");
    await expect(banner).toContainText("cannot be called guaranteed");
    await expect(page.getByTestId("phase")).toHaveText("intervene");

    // The badge must show a real measurement. The budget itself is judged over ten samples by
    // tests/e2e/latency.live.spec.ts; a single turn's endpointing varies too much to gate on here.
    const latencyText = page.getByTestId("intervention-latency");
    await expect(latencyText).toHaveText(/^\d+ ms$/, { timeout: 20_000 });
    const latencyMs = Number((await latencyText.textContent())!.replace(/\D/g, ""));
    const breakdown = await page.evaluate(() => {
      const w = window as unknown as {
        __saakshi_last_latency?: { totalMs?: number; sttLagMs?: number; replyMs: number };
      };
      return w.__saakshi_last_latency ?? null;
    });
    console.log(`[golden] intervention latency ${latencyMs} ms ${JSON.stringify(breakdown)}`);
    expect(latencyMs).toBeGreaterThan(0);
    expect(latencyMs).toBeLessThanOrEqual(SANITY_CEILING_MS);

    // Acknowledge from the room, which returns the phase to OBSERVE.
    await page.getByTestId("acknowledge").click();
    await expect(page.getByTestId("phase")).toHaveText("observe", { timeout: 20_000 });
    await expect(
      page.locator('[data-testid="violation"][data-id="guaranteed_returns"]'),
    ).toContainText(/acknowledged|corrected/);

    // Six or more disclosures within one pass of the script.
    await expect
      .poll(async () => boardMet(page), { timeout: 120_000, intervals: [2_000] })
      .toBeGreaterThanOrEqual(6);

    // The nudge names whatever is still missing (or says everything was covered).
    await page.getByTestId("verify").click();
    await expect(page.getByTestId("phase")).toHaveText("nudge", { timeout: 15_000 });
    const nudge = page.getByTestId("nudge-banner");
    await expect(nudge).toBeVisible();
    await expect(nudge).toContainText(/Before we finish|Every required disclosure/);

    const summary = (await page.getByTestId("board-summary").textContent()) ?? "";
    const analyzer = (await page.getByTestId("analyzer-status").textContent()) ?? "";
    console.log(`[golden] board: ${summary}; analyzer: ${analyzer}`);
    // ---------------------------------------------------------------- teach-back (v3)
    // The nudge line ends and the room moves itself into the teach-back, loading questions built
    // from what the advisor actually said.
    await expect(page.getByTestId("phase")).toHaveText("teachback", { timeout: 60_000 });
    const panel = page.getByTestId("teachback-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => panel.locator('[data-testid^="teachback-q-"]').count(), {
        timeout: 45_000,
        intervals: [1_000],
      })
      .toBeGreaterThanOrEqual(3);
    const questions = await panel.locator('[data-testid^="teachback-q-"] p').first().textContent();
    console.log(`[golden] first teach-back question: ${questions?.trim()}`);

    // The WAV keeps looping the advisor's pitch, so how many answers the agent records depends on
    // what it hears; that is reported, not gated. The operator's control is what ends the phase.
    await page.waitForTimeout(20_000);
    const progress = (await page.getByTestId("teachback-progress").textContent()) ?? "";
    console.log(`[golden] teach-back progress: ${progress.trim()}`);

    await page.getByTestId("finish-teachback").click();

    // ---------------------------------------------------------------- certificate
    const card = page.getByTestId("certificate-card");
    await expect(card).toBeVisible({ timeout: 45_000 });
    const certId = ((await page.getByTestId("certificate-id").textContent()) ?? "").trim();
    const certHash = ((await page.getByTestId("certificate-hash").textContent()) ?? "").trim();
    console.log(`[golden] certificate ${certId} ${certHash}`);
    expect(certId).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(certHash).toMatch(/^[0-9a-f]{64}$/);

    // Issuing the certificate ends the session by itself, so Stop is only there if something stalled.
    const stop = page.getByRole("button", { name: "Stop", exact: true });
    if (await stop.isVisible()) await stop.click();
    await expect(page.getByTestId("phase")).toHaveText("done", { timeout: 30_000 });

    // The proof: the stored record verifies on its own, and one altered character does not.
    await page.goto(`/verify/${certId}`);
    await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "valid");
    await expect(page.getByTestId("verdict")).toContainText("VALID");

    await page.goto(`/verify/${certId}?tamper=quote`);
    await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "tampered");
    await expect(page.getByTestId("verdict")).toContainText("TAMPERED");

    await saveReport(page, {
      latencyMs,
      breakdown,
      summary,
      analyzer,
      teachback: progress.trim(),
      certificate: { id: certId, hash: certHash },
    });
  });
});

async function boardMet(page: Page): Promise<number> {
  const text = (await page.getByTestId("board-summary").textContent()) ?? "";
  const m = /(\d+) of (\d+)/.exec(text);
  return m ? Number(m[1]) : 0;
}

async function saveReport(page: Page, extra: Record<string, unknown>): Promise<void> {
  const rows = await page.locator('[data-testid="violation"]').evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute("data-id"),
      severity: el.getAttribute("data-severity"),
      text: (el.textContent ?? "").replace(/\s+/g, " ").slice(0, 200),
    })),
  );
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/golden-report.json",
    JSON.stringify({ ran_at: new Date().toISOString(), ...extra, violations: rows }, null, 2),
  );
}
