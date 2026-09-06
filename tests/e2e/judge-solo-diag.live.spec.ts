import { expect, test } from "@playwright/test";

// Diagnostic for judge-solo mode: does the pre-rendered advisor actually reach Streaming STT?
// Run with SAAKSHI_DIAG=1 and the customer-only WAV.
test.skip(!process.env.SAAKSHI_DIAG, "diagnostic only");

test("diagnose the synthetic advisor reaching the recogniser", async ({ page }) => {
  test.setTimeout(180_000);
  const lines: string[] = [];
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) lines.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => lines.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("response", (r) => {
    if (r.url().includes("/demo/advisor/")) {
      lines.push(`advisor audio ${r.url().split("/").pop()} -> ${r.status()}`);
    }
  });

  await page.goto("/session");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForTimeout(60_000);

  lines.push(`phase: ${await page.getByTestId("phase").textContent()}`);
  lines.push(`mic: ${await page.getByTestId("mic-status").textContent()}`);
  lines.push(`ears: ${await page.getByTestId("ears-status").textContent()}`);
  const panel = page.getByTestId("judge-solo-panel");
  lines.push(`judge-solo status attr: ${await panel.getAttribute("data-status")}`);
  lines.push(`judge-solo badge: ${await page.getByTestId("judge-solo-status").textContent()}`);
  const turns = await page.locator('[data-testid="turn"]').count();
  lines.push(`transcript turns: ${turns}`);
  const texts = await page.locator('[data-testid="turn"]').allTextContents();
  for (const t of texts.slice(0, 12)) lines.push(`  turn: ${t.replace(/\s+/g, " ").slice(0, 140)}`);

  await page.getByRole("button", { name: /Debug drawer/ }).click();
  const rows = await page.locator("details").allTextContents();
  const labels = new Map<string, string[]>();
  for (const row of rows) {
    const order = /"turn_order":\s*(\d+)/.exec(row)?.[1];
    const label = /"speaker_label":\s*"([^"]*)"/.exec(row)?.[1];
    const final = /"end_of_turn":\s*true/.test(row);
    if (order && label && final) {
      const text = /"transcript":\s*"([^"]{0,60})/.exec(row)?.[1] ?? "";
      labels.set(order, [label, text]);
    }
  }
  const decisions = rows
    .filter((r) => /client(roles|phase|echo\.ignored|judge_solo\.line)/.test(r))
    .map((r) => r.replace(/\s+/g, " ").slice(0, 190));
  lines.push(`calibration decisions (${decisions.length}):`);
  for (const d of decisions.slice(0, 24)) lines.push(`  ${d}`);
  lines.push(`finalized turns by speaker label (${labels.size}):`);
  for (const [order, [label, text]] of [...labels].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    lines.push(`  turn ${order}: label=${label} "${text}"`);
  }

  console.log("\n[judge-solo-diag]\n" + lines.join("\n"));
  expect(true).toBe(true);
});
