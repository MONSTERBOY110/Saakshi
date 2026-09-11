import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The API key for live evaluations. Vitest does not load .env, so fall back to reading it, with
 * .env.local winning as it does in Next.js. Returns "" when there is no key, so the caller can
 * skip rather than send an unauthenticated request.
 */
/**
 * Every KEY=VALUE line from .env.local then .env, with process.env winning, so live evals see the
 * same LLM provider configuration the server does.
 */
export function envWithFiles(): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = {};
  for (const file of [".env", ".env.local"]) {
    const path = join(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) merged[m[1]!] = m[2]!.trim().replace(/^"(.*)"$/, "$1");
    }
  }
  return { ...merged, ...process.env };
}

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
