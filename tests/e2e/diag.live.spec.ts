import { expect, test } from "@playwright/test";

// Temporary diagnostic: what happens on the sockets after Start. Run with SAAKSHI_DIAG=1.
test.skip(!process.env.SAAKSHI_DIAG, "diagnostic only");

test("diagnose socket startup", async ({ page }) => {
  test.setTimeout(90_000);
  const lines: string[] = [];
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type()))
      lines.push(`console.${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => lines.push(`pageerror: ${e.message.slice(0, 300)}`));
  page.on("websocket", (ws) => {
    const url = ws.url().replace(/token=[^&]+/, "token=<t>");
    lines.push(`ws open attempt: ${url.slice(0, 160)}`);
    ws.on("socketerror", (err) =>
      lines.push(`ws socketerror: ${String(err).slice(0, 200)} (${url.slice(0, 60)})`),
    );
    ws.on("close", () => lines.push(`ws close (${url.slice(0, 60)})`));
    let frames = 0;
    ws.on("framereceived", () => {
      frames += 1;
      if (frames === 1) lines.push(`ws first frame received (${url.slice(0, 60)})`);
    });
  });
  page.on("requestfailed", (r) =>
    lines.push(`request failed: ${r.url().slice(0, 120)} ${r.failure()?.errorText}`),
  );
  page.on("response", (r) => {
    if (r.url().includes("/api/token/"))
      lines.push(`token route ${r.url().slice(-16)} -> ${r.status()}`);
  });

  await page.goto("/session");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForTimeout(20_000);

  lines.push(`phase: ${await page.getByTestId("phase").textContent()}`);
  lines.push(`mic: ${await page.getByTestId("mic-status").textContent()}`);
  lines.push(`ears: ${await page.getByTestId("ears-status").textContent()}`);
  lines.push(`mouth: ${await page.getByTestId("mouth-status").textContent()}`);
  const alert = page.getByRole("alert");
  if (await alert.count()) lines.push(`alert: ${await alert.first().textContent()}`);

  await page.getByRole("button", { name: /Debug drawer/ }).click();
  const rows = await page.locator("details summary").allTextContents();
  lines.push(`drawer rows (${rows.length}):`);
  for (const r of rows.slice(0, 40)) lines.push(`  ${r.replace(/\s+/g, " ").slice(0, 200)}`);

  console.log("\n[diag]\n" + lines.join("\n"));
  expect(true).toBe(true);
});
