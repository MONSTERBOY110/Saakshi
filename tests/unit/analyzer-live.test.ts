import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeWithGateway } from "@/lib/analyzer/gateway";
import type { AnalyzeRequest } from "@/lib/analyzer/schema";
import { getPack } from "@/lib/rules/load";

// Live evaluation of the layer-2 analyzer over the golden dialogues. Costs a few cents.
// Run: SAAKSHI_LIVE_EVAL=1 pnpm exec vitest run tests/unit/analyzer-live.test.ts
type Dialogue = {
  id: string;
  turns: Array<{ order: number; role: "advisor" | "customer"; text: string }>;
  expect: { violations: string[]; checkpoints: string[] };
};
type Fixture = { context: AnalyzeRequest["context"]; dialogues: Dialogue[] };

const live = !!process.env.SAAKSHI_LIVE_EVAL;
// The account LLM Gateway limit is 2 requests per 60 s per model (docs/decisions.md), so the eval
// paces itself. Override with SAAKSHI_EVAL_PACE_MS when the account has a higher limit.
const PACE_MS = Number(process.env.SAAKSHI_EVAL_PACE_MS ?? 35_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function apiKey(): string {
  if (process.env.ASSEMBLYAI_API_KEY) return process.env.ASSEMBLYAI_API_KEY;
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return "";
  const line = readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("ASSEMBLYAI_API_KEY="));
  return line ? line.slice("ASSEMBLYAI_API_KEY=".length).trim() : "";
}

describe.skipIf(!live)("analyzer live eval (SAAKSHI_LIVE_EVAL)", () => {
  it("reaches precision 0.9 or better on violations over the golden dialogues", async () => {
    const pack = getPack("insurance-ulip-in");
    const fixture = JSON.parse(
      readFileSync(join(process.cwd(), "tests", "fixtures", "analyzer", "dialogues.json"), "utf8"),
    ) as Fixture;
    const key = apiKey();
    expect(key, "ASSEMBLYAI_API_KEY").not.toBe("");
    const deps = {
      apiKey: key,
      baseUrl: process.env.LLM_GATEWAY_BASE_URL ?? "https://llm-gateway.assemblyai.com/v1",
      models: (
        process.env.LLM_ANALYZER_MODELS ??
        "gemini-3.5-flash-lite,claude-haiku-4-5-20251001,qwen3.5-4b-32k-fast"
      )
        .split(",")
        .map((m) => m.trim()),
      timeoutMs: 8000,
    };
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let cpTp = 0;
    let cpFn = 0;
    let rateLimited = 0;
    const latencies: number[] = [];
    const rows: string[] = [];
    let first = true;
    for (const d of fixture.dialogues) {
      if (!first) await sleep(PACE_MS);
      first = false;
      const req: AnalyzeRequest = {
        pack_id: pack.id,
        context: fixture.context,
        turns: d.turns.map((t) => ({ ...t, start_ms: t.order * 3000 })),
      };
      const out = await analyzeWithGateway(deps, req, pack);
      if (!out.ok) {
        // A 429 is the account's gateway quota, not a wrong answer, so it does not count against
        // accuracy; anything else does.
        const limited = /HTTP 429/.test(out.error);
        rows.push(`${d.id}: ${limited ? "RATE LIMITED" : "FAILED"} ${out.error}`);
        if (limited) {
          rateLimited += 1;
        } else {
          fn += d.expect.violations.length;
          cpFn += d.expect.checkpoints.length;
        }
        continue;
      }
      latencies.push(out.latencyMs);
      const gotV = new Set(
        out.analysis.violations.filter((v) => v.confidence >= 0.8).map((v) => v.id),
      );
      const gotC = new Set(
        out.analysis.checkpoints_satisfied.filter((c) => c.confidence >= 0.6).map((c) => c.id),
      );
      for (const id of gotV) {
        if (d.expect.violations.includes(id)) tp++;
        else fp++;
      }
      for (const id of d.expect.violations) if (!gotV.has(id)) fn++;
      for (const id of d.expect.checkpoints) {
        if (gotC.has(id)) cpTp++;
        else cpFn++;
      }
      rows.push(
        `${d.id}: violations ${[...gotV].join(",") || "-"} (want ${d.expect.violations.join(",") || "-"}); checkpoints ${[...gotC].join(",") || "-"} (want ${d.expect.checkpoints.join(",") || "-"}); ${out.model} ${out.latencyMs} ms`,
      );
    }
    const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
    const cpRecall = cpTp + cpFn === 0 ? 1 : cpTp / (cpTp + cpFn);
    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const report = {
      ran_at: new Date().toISOString(),
      models: deps.models,
      rows,
      dialogues: {
        total: fixture.dialogues.length,
        evaluated: latencies.length,
        rate_limited: rateLimited,
      },
      violations: { precision, recall, tp, fp, fn },
      checkpoints: { recall: cpRecall, tp: cpTp, fn: cpFn },
      latency_ms: { p50, samples: latencies.length },
    };
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/analyzer-eval.json", JSON.stringify(report, null, 2));
    console.log(
      `\n[analyzer-eval]\n${rows.join("\n")}\nevaluated ${latencies.length} of ${fixture.dialogues.length} (${rateLimited} rate limited); violations precision ${precision.toFixed(2)} recall ${recall.toFixed(2)}; checkpoint recall ${cpRecall.toFixed(2)}; latency p50 ${p50} ms`,
    );
    // Accuracy is judged on the dialogues that actually reached a model.
    expect(latencies.length, "dialogues evaluated").toBeGreaterThanOrEqual(6);
    expect(precision).toBeGreaterThanOrEqual(0.9);
    expect(recall).toBeGreaterThanOrEqual(0.8);
  }, 900_000);
});
