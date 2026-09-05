import { NextResponse } from "next/server";
import { mintAgentToken } from "@/lib/aai/tokens";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`agent:${ip}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    const token = await mintAgentToken();
    return NextResponse.json(token, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[token/agent]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "token_mint_failed" }, { status: 502 });
  }
}
