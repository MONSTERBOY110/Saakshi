import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { storeCertificate } from "./fixtures/certificate";

// Design inspection only: one batched round of every surface at desktop and phone width, so the
// whole cycle is looked at once rather than screenshotted piecemeal. Run with SAAKSHI_SHOTS=1.
test.skip(!process.env.SAAKSHI_SHOTS, "design inspection only");

const DESKTOP = { width: 1440, height: 950 };
const PHONE = { width: 390, height: 844 };
const OUT = "test-results/shots";

test("capture every surface at both widths", async ({ page, request }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  const cert = await storeCertificate(request);

  const surfaces: Array<{ name: string; path: string }> = [
    { name: "landing", path: "/" },
    { name: "room-setup", path: "/session" },
    { name: "verify-valid", path: `/verify/${cert.id}` },
    { name: "verify-tampered", path: `/verify/${cert.id}?tamper=quote` },
  ];

  for (const { name, path } of surfaces) {
    for (const [label, size] of [
      ["desktop", DESKTOP],
      ["phone", PHONE],
    ] as const) {
      await page.setViewportSize(size);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: true });
    }
  }
  expect(true).toBe(true);
});
