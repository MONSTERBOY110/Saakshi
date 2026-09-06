import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { finaliseCertificate } from "@/lib/cert/build";
import { verifyCertificate } from "@/lib/cert/chain";
import { CertificateDraftSchema, type StoreCertificateResponse } from "@/lib/cert/schema";
import { getCertificateStore } from "@/lib/cert/store";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Store a Consent Certificate. The client never supplies the hash: the server assigns the id,
 * recomputes the certificate hash over the canonical JSON, and refuses anything whose turn chain
 * does not verify, so a certificate can only exist if its own proofs hold (prd.md FR-9, FR-10).
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`cert:${ip}`, 20)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = CertificateDraftSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "invalid_certificate", issues: body.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const certificate = await finaliseCertificate(body.data, nanoid(16));
  const check = await verifyCertificate(certificate);
  if (!check.valid) {
    // The chain head the browser computed does not match its own turn digest.
    return NextResponse.json({ error: "chain_mismatch", ...check }, { status: 422 });
  }
  try {
    await getCertificateStore().put(certificate);
  } catch (err) {
    console.error("[certificate]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "store_unavailable" }, { status: 502 });
  }
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const response: StoreCertificateResponse = {
    id: certificate.id,
    certificate_hash: certificate.certificate_hash,
    url: `${base.replace(/\/$/, "")}/verify/${certificate.id}`,
  };
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
