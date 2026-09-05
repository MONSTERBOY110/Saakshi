import { defineConfig, devices } from "@playwright/test";

import { resolve } from "node:path";

// Set PLAYWRIGHT_BASE_URL to run the same suite against a Vercel preview.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Fake mic: Chromium synthesises a tone unless SAAKSHI_FAKE_WAV points at a 16-bit PCM WAV, which
// it then plays as the microphone (looping). tests/fixtures/golden-draft.wav is the two-voice script.
const fakeMicArgs = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
if (process.env.SAAKSHI_FAKE_WAV) {
  fakeMicArgs.push(`--use-file-for-fake-audio-capture=${resolve(process.env.SAAKSHI_FAKE_WAV)}`);
}

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "retain-on-failure", permissions: ["microphone"] },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: fakeMicArgs },
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
