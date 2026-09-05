import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Live check against AssemblyAI with Chromium's fake microphone. Opt in with
// SAAKSHI_LIVE_E2E=1 so CI (which has no API key) skips it. Costs a few cents per run.
// Every WebSocket frame is recorded to test-results/ws-frames.json with audio stripped, which
// is how tests/fixtures/ gets refreshed (see scripts/split-fixtures.mjs). Point SAAKSHI_FAKE_WAV
// at tests/fixtures/golden-draft.wav to feed two synthetic speakers instead of a tone.
test.describe("dual session (live AssemblyAI)", () => {
  test.skip(!process.env.SAAKSHI_LIVE_E2E, "set SAAKSHI_LIVE_E2E=1 to run against live sockets");

  test("opens both sockets, gets Begin and session.ready, and closes cleanly", async ({ page }) => {
    const holdMs = Number(process.env.SAAKSHI_LIVE_HOLD_MS ?? 12_000);
    test.setTimeout(holdMs + 100_000);
    const frames = recordFrames(page);
    const drawerText = async (): Promise<string[]> =>
      page.locator("details summary span.font-semibold").allTextContents();

    try {
      await page.goto("/session");
      await page.getByRole("button", { name: "Start", exact: true }).click();

      await expect(page.getByTestId("mic-status")).toHaveText("24000 Hz", { timeout: 15_000 });
      await expect(page.getByTestId("ears-status")).toHaveText("open", { timeout: 20_000 });
      await expect(page.getByTestId("mouth-status")).toHaveText("ready", { timeout: 20_000 });

      await page.getByRole("button", { name: /Debug drawer/ }).click();
      const filter = page.getByPlaceholder("filter by type, e.g. Turn");
      for (const type of ["Begin", "session.ready"]) {
        await filter.fill(type);
        await expect(page.getByText(type, { exact: true }).first()).toBeVisible({
          timeout: 15_000,
        });
      }
      await page.keyboard.press("Escape");

      // Let the greeting play, heartbeats arrive, and the fake mic audio flow.
      await page.waitForTimeout(holdMs);

      await page.getByRole("button", { name: /Debug drawer/ }).click();
      const expected = ["Heartbeat", "transcript.agent", "reply.done"];
      if (process.env.SAAKSHI_FAKE_WAV) expected.push("Turn");
      for (const type of expected) {
        await filter.fill(type);
        await expect(page.getByText(type, { exact: true }).first()).toBeVisible({
          timeout: 15_000,
        });
      }
      for (const type of ["session.error", "unparsed"]) {
        await filter.fill(type);
        await expect(
          page.getByText("No events yet."),
          `${type} rows: ${(await drawerText()).join(" | ")}`,
        ).toBeVisible();
      }
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await expect(page.getByTestId("phase")).toHaveText("stopped", { timeout: 15_000 });

      await page.getByRole("button", { name: /Debug drawer/ }).click();
      for (const type of ["Termination", "session.ended"]) {
        await filter.fill(type);
        await expect(page.getByText(type, { exact: true }).first()).toBeVisible();
      }
      await filter.fill("unparsed");
      await expect(
        page.getByText("No events yet."),
        `unparsed rows after stop: ${(await drawerText()).join(" | ")}`,
      ).toBeVisible();
    } finally {
      mkdirSync("test-results", { recursive: true });
      writeFileSync("test-results/ws-frames.json", JSON.stringify(frames, null, 1));
      const unparsed = frames.filter(
        (f) => f.json && typeof f.json === "object" && "unparseable" in (f.json as object),
      );
      console.log(`[live] recorded ${frames.length} frames (${unparsed.length} unparseable)`);
    }
  });
});

type Frame = {
  t: number;
  socket: "stt" | "agent" | "other";
  dir: "in" | "out";
  json?: unknown;
  binary_bytes?: number;
};

/** Record every frame on both sockets. Audio never touches disk: base64 is replaced by its length. */
function recordFrames(page: Page): Frame[] {
  const frames: Frame[] = [];
  const t0 = Date.now();
  page.on("websocket", (ws) => {
    const host = new URL(ws.url()).host;
    const socket: Frame["socket"] = host.startsWith("streaming.")
      ? "stt"
      : host.startsWith("agents.")
        ? "agent"
        : "other";
    if (socket === "other") return;
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
