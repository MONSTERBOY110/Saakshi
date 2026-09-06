import { NextResponse } from "next/server";
import { analyzerModels, ANALYZE_TIMEOUT_MS, gatewayBaseUrl } from "@/lib/analyzer/config";
import { analyzeWithGateway } from "@/lib/analyzer/gateway";
import { AnalyzeRequestSchema, type AnalyzeResponse } from "@/lib/analyzer/schema";
import { getPack } from "@/lib/rules/load";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`analyze:${ip}`, 60)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = AnalyzeRequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: body.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  let pack;
  try {
    pack = getPack(body.data.pack_id);
  } catch {
    return NextResponse.json({ error: "unknown_pack" }, { status: 400 });
  }
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });

  const out = await analyzeWithGateway(
    { apiKey, baseUrl: gatewayBaseUrl(), models: analyzerModels(), timeoutMs: ANALYZE_TIMEOUT_MS },
    body.data,
    pack,
  );
  if (!out.ok) {
    console.error("[analyze]", out.error);
    // The gateway rate limits per account and model; tell the client how long to wait.
    const limited = /HTTP 429/.test(out.error);
    return NextResponse.json(
      {
        error: limited ? "analyzer_rate_limited" : "analyzer_unavailable",
        latency_ms: out.latencyMs,
        ...(limited ? { retry_after: 60 } : {}),
      },
      { status: limited ? 429 : 502 },
    );
  }
  const response: AnalyzeResponse = {
    analysis: out.analysis,
    model: out.model,
    latency_ms: out.latencyMs,
    request_id: out.requestId,
  };
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
