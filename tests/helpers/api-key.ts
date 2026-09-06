import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The API key for live evaluations. Vitest does not load .env, so fall back to reading it, with
 * .env.local winning as it does in Next.js. Returns "" when there is no key, so the caller can
 * skip rather than send an unauthenticated request.
 */
export function apiKeyFromEnv(): string {
  if (process.env.ASSEMBLYAI_API_KEY) return process.env.ASSEMBLYAI_API_KEY;
  for (const file of [".env.local", ".env"]) {
    const path = join(process.cwd(), file);
    if (!existsSync(path)) continue;
    const line = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("ASSEMBLYAI_API_KEY="));
    if (line) return line.slice("ASSEMBLYAI_API_KEY=".length).trim();
  }
  return "";
}
