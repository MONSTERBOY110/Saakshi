import { NextResponse } from "next/server";
import { getCertificateStore } from "@/lib/cert/store";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public read. Certificate ids are unguessable; the payload holds quotes and hashes, no audio. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`cert-get:${ip}`, 60)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    const certificate = await getCertificateStore().get(id);
    if (!certificate) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(certificate, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[certificate/get]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "store_unavailable" }, { status: 502 });
  }
}
