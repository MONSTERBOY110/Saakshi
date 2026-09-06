import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { storeCertificate } from "./fixtures/certificate";

// The images the README ships. They are captured from a real run against the live APIs, never
// mocked up, so what a reader sees on GitHub is what the product actually does. Run against a
// production server so no development badge appears:
//   pnpm build && pnpm start
//   SAAKSHI_README_SHOTS=1 SAAKSHI_FAKE_WAV=tests/fixtures/judge-solo-customer.wav \
//     PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test tests/e2e/readme-shots.live.spec.ts
test.skip(!process.env.SAAKSHI_README_SHOTS, "README capture only");

const WIDE = { width: 1440, height: 900 };
// The hero image wants the whole first screen, both rows of the tabla included, so it is
// captured a little taller than a laptop fold rather than cropped mid card.
const HERO = { width: 1440, height: 1040 };
const OUT = "docs/images";

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

test("landing hero and verify page", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(WIDE);

  await page.setViewportSize(HERO);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/hero.png` });
  await page.setViewportSize(WIDE);

  const cert = await storeCertificate(request);
  await page.goto(`/verify/${cert.id}`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/verify.png`, fullPage: true });

  await page.goto(`/verify/${cert.id}?tamper=quote`);
  await page.waitForLoadState("networkidle");
  // Both certificate shots run full page so they sit at the same height side by side in the README.
  await page.screenshot({ path: `${OUT}/verify-tampered.png`, fullPage: true });
});

test("the room at the moment Saakshi interrupts", async ({ page }) => {
  test.setTimeout(420_000);
  test.skip(!process.env.SAAKSHI_FAKE_WAV, "needs a fixture WAV");
  await page.setViewportSize(WIDE);

  await page.goto("/session");
  await Promise.all([page.request.get("/api/token/stt"), page.request.get("/api/token/agent")]);
  // The two-voice fixture already carries an advisor, so the synthetic one stays off. It reaches
  // the planted claim in about a minute, which is the moment worth photographing.
  await page.getByTestId("judge-solo-toggle").uncheck();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByTestId("ears-status")).toHaveText("open", { timeout: 45_000 });

  // Wait for the one moment worth photographing: the flag called, with the board part filled.
  const banner = page.getByTestId("intervention-banner");
  await expect(banner).toBeVisible({ timeout: 300_000 });
  await expect(page.getByTestId("intervention-latency")).toHaveText(/\d+ ms/, { timeout: 25_000 });
  await page.screenshot({ path: `${OUT}/room.png` });

  await page.getByRole("button", { name: "Stop", exact: true }).click();
});
