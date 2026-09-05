import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Automates spikes S4 (conversation.message context), S5 (verbatim reply.create) and S3 (agent
// idle with no input.audio) from trd.md section 17 against live AssemblyAI. Opt in with
// SAAKSHI_LIVE_SPIKES=1. S3 waits SAAKSHI_S3_IDLE_MS (default 300000). Results are printed with a
// [spike] prefix and every frame is written to test-results/ws-frames-spikes.json.
test.describe("spikes S3-S5 (live AssemblyAI)", () => {
  test.skip(!process.env.SAAKSHI_LIVE_SPIKES, "set SAAKSHI_LIVE_SPIKES=1 to run the live spikes");

  test("S4 context injection, S5 verbatim x10, S3 five idle minutes", async ({ page }) => {
    const idleMs = Number(process.env.SAAKSHI_S3_IDLE_MS ?? 300_000);
    test.setTimeout(idleMs + 360_000);
    const frames = recordFrames(page);
    const results: Record<string, unknown> = {};

    try {
      await page.goto("/session");
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await expect(page.getByTestId("ears-status")).toHaveText("open", { timeout: 20_000 });
      await expect(page.getByTestId("mouth-status")).toHaveText("ready", { timeout: 20_000 });
      // Let the greeting finish before issuing replies.
      await expect(page.getByText(/Please say your name/)).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(2_000);

      // S4: inject a fact as a system conversation.message, then ask the agent to repeat it.
      await page.getByRole("button", { name: "Inject fact (S4)" }).click();
      await page.waitForTimeout(1_000);
      await page.getByRole("button", { name: "Ask to repeat" }).click();
      const s4 = page
        .locator("li")
        .filter({ hasText: /4,?471|four.*four.*seven.*one/i })
        .first();
      const s4ok = await s4
        .waitFor({ timeout: 25_000 })
        .then(() => true)
        .catch(() => false);
      const captions = await page.locator("ul li").allTextContents();
      results.S4 = { pass: s4ok, captions: captions.slice(-3) };
      console.log("[spike] S4", JSON.stringify(results.S4));
      await page.waitForTimeout(3_000);

      // S5: ten verbatim reply.create calls; the page counts exact matches.
      await page.getByRole("button", { name: "Verbatim trial x10 (S5)" }).click();
      const done = page.getByText(/^\d+\/10 exact$/);
      await expect(done).toBeVisible({ timeout: 240_000 });
      const s5text = await done.textContent();
      const outputs = await page.locator("ol li").allTextContents();
      results.S5 = { result: s5text, outputs };
      console.log("[spike] S5", JSON.stringify(results.S5));
      const latency = await page.getByText(/^latency/).textContent();
      results.latency = latency;
      console.log("[spike] latency badge:", latency);

      // S3: gate the mic away from the agent, wait, then ask for a reply.
      const micSwitch = page.getByRole("switch", { name: "Mic to Mouth" });
      await micSwitch.click();
      await expect(micSwitch).toHaveAttribute("aria-checked", "false");
      console.log(`[spike] S3 idling ${idleMs} ms with no input.audio`);
      await page.waitForTimeout(idleMs);
      await expect(page.getByTestId("mouth-status")).toHaveText("ready");
      const box = page.getByRole("textbox").first();
      await box.fill("Say exactly this and nothing else: Still here after the wait.");
      await page.getByRole("button", { name: "Reply now (S3)" }).click();
      const s3ok = await page
        .getByText(/still here after the wait/i)
        .first()
        .waitFor({ timeout: 25_000 })
        .then(() => true)
        .catch(() => false);
      results.S3 = { pass: s3ok, idleMs };
      console.log("[spike] S3", JSON.stringify(results.S3));

      await page.getByRole("button", { name: /Debug drawer/ }).click();
      const filter = page.getByPlaceholder("filter by type, e.g. Turn");
      await filter.fill("session.error");
      results.sessionErrors = await page
        .locator("details summary span.font-semibold")
        .allTextContents();
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await expect(page.getByTestId("phase")).toHaveText("stopped", { timeout: 15_000 });
      expect(s3ok, "S3: agent replied after idle").toBe(true);
    } finally {
      mkdirSync("test-results", { recursive: true });
      writeFileSync("test-results/ws-frames-spikes.json", JSON.stringify(frames, null, 1));
      writeFileSync("test-results/spike-results.json", JSON.stringify(results, null, 2));
      console.log(
        `[spike] recorded ${frames.length} frames; results in test-results/spike-results.json`,
      );
    }
  });
});

type Frame = {
  t: number;
  socket: "stt" | "agent";
  dir: "in" | "out";
  json?: unknown;
  binary_bytes?: number;
};

function recordFrames(page: Page): Frame[] {
  const frames: Frame[] = [];
  const t0 = Date.now();
  page.on("websocket", (ws) => {
    const host = new URL(ws.url()).host;
    const socket: Frame["socket"] | null = host.startsWith("streaming.")
      ? "stt"
      : host.startsWith("agents.")
        ? "agent"
        : null;
    if (!socket) return;
    const push = (dir: Frame["dir"], payload: string | Buffer) => {
      const t = Date.now() - t0;
      if (typeof payload !== "string")
        return frames.push({ t, socket, dir, binary_bytes: payload.length });
      try {
        frames.push({ t, socket, dir, json: stripAudio(JSON.parse(payload)) });
      } catch {
        frames.push({ t, socket, dir, json: { unparseable: payload.slice(0, 200) } });
      }
    };
    ws.on("framereceived", (f) => push("in", f.payload));
    ws.on("framesent", (f) => push("out", f.payload));
  });
  return frames;
}

function stripAudio(msg: unknown): unknown {
  if (!msg || typeof msg !== "object") return msg;
  const m = msg as Record<string, unknown>;
  if (typeof m.data === "string" && m.type === "reply.audio") {
    return { ...m, data: undefined, data_len: m.data.length, data_head: m.data.slice(0, 32) };
  }
  if (typeof m.audio === "string" && m.type === "input.audio") {
    return { ...m, audio: undefined, audio_len: m.audio.length };
  }
  return m;
}
