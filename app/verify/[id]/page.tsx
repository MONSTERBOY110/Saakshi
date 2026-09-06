import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { verifyCertificate } from "@/lib/cert/chain";
import { CertificateSchema, type Certificate } from "@/lib/cert/schema";
import { getCertificateStore } from "@/lib/cert/store";
import { VerdictBanner } from "@/components/verdict-banner";
import { EvidenceTable } from "@/components/evidence-table";

// Public verification (P0-9, FR-10). Everything here is recomputed from the stored payload:
// the chain head over the turn digest and the certificate hash over the canonical JSON. Nothing
// is trusted from the request, and no transcript or audio is stored to reveal.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify a Consent Certificate",
  description: "Recompute the hash chain of a Saakshi Consent Certificate and see the evidence.",
};

export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tamper?: string }>;
}) {
  const { id } = await params;
  const { tamper } = await searchParams;
  const stored = await load(id);
  // The demo needs to show what an altered record looks like. This edits a copy in memory for
  // display only, says so plainly, and never touches what is stored.
  const certificate = stored && tamper ? tamperCopy(stored) : stored;

  if (!certificate) {
    return (
      <Shell>
        <VerdictBanner verdict="not_found" id={id} />
        <p className="text-ink-soft text-sm">
          No certificate with this identifier. Certificates expire ninety days after the
          conversation.
        </p>
      </Shell>
    );
  }

  const result = await verifyCertificate(certificate);
  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/verify/${certificate.id}`;
  const qr = await QRCode.toString(url || `/verify/${certificate.id}`, {
    type: "svg",
    margin: 0,
    width: 132,
    color: { light: "#0000" },
  });

  return (
    <Shell>
      {tamper && (
        <p data-testid="tamper-notice" className="card-print-tight bg-sun px-3 py-2 text-sm">
          <span className="plate">Demonstration.</span> One character of one quote has been changed
          in this view only. The stored record is untouched:{" "}
          <a
            className="decoration-carnival underline decoration-2 underline-offset-2"
            href={`/verify/${certificate.id}`}
          >
            see the original
          </a>
          .
        </p>
      )}
      <VerdictBanner
        verdict={result.valid ? "valid" : "tampered"}
        id={certificate.id}
        chainOk={result.chainOk}
        hashOk={result.hashOk}
      />
      {!tamper && result.valid && (
        <p className="text-ink-soft text-sm print:hidden">
          <a
            data-testid="tamper-link"
            className="decoration-carnival underline decoration-2 underline-offset-4"
            href={`/verify/${certificate.id}?tamper=quote`}
          >
            Show what an altered copy looks like
          </a>
        </p>
      )}
      <section className="card-print grid gap-4 border-[3px] p-4 sm:grid-cols-[1fr_auto]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
          <Row label="Advisor">{certificate.parties.advisor}</Row>
          <Row label="Customer">{certificate.parties.customer}</Row>
          <Row label="Product">{certificate.product.name}</Row>
          <Row label="Protocol pack">
            {certificate.pack.id} v{certificate.pack.version} ({certificate.pack.jurisdiction})
          </Row>
          <Row label="Conversation">
            {formatWhen(certificate.session.started_at)} to{" "}
            {formatWhen(certificate.session.ended_at)}
          </Row>
          <Row label="Turns hashed">{certificate.turns_digest.count}</Row>
          <Row label="Language">{certificate.language_mix}</Row>
          {certificate.session.gaps.length > 0 && (
            <Row label="Connection gaps">{certificate.session.gaps.length}</Row>
          )}
        </dl>
        <div
          aria-label="QR code linking to this page"
          className="print:hidden"
          dangerouslySetInnerHTML={{ __html: qr }}
        />
      </section>

      <EvidenceTable certificate={certificate} />

      <section className="rule-dashed text-ink-soft space-y-1.5 pt-4 text-xs">
        <h2 className="ribbon ribbon-quiet mb-1">How this was checked</h2>
        <p>
          The chain starts from the pack identity and the speech session id, then folds in every
          finalized turn in order: its number, who spoke, a hash of the words, and the start and end
          time. Changing any of them changes the head.
        </p>
        <p className="num break-all">
          <span className="plate text-ink">chain head</span> {certificate.turns_digest.chain_head}
        </p>
        <p className="num break-all">
          <span className="plate text-ink">certificate hash</span> {certificate.certificate_hash}
        </p>
        <p>
          The certificate stores hashes of the words, never the words themselves, and no audio is
          recorded at any point.
        </p>
      </section>
    </Shell>
  );
}

async function load(id: string): Promise<Certificate | null> {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) return null;
  try {
    const raw = await getCertificateStore().get(id);
    if (!raw) return null;
    const parsed = CertificateSchema.safeParse(raw);
    return parsed.success ? parsed.data : (raw as Certificate);
  } catch {
    return null;
  }
}

/** Change one character of one quote, the way a careless or dishonest edit would. */
function tamperCopy(certificate: Certificate): Certificate {
  const target = certificate.checkpoints.find((c) => c.evidence);
  if (!target?.evidence) {
    return { ...certificate, language_mix: `${certificate.language_mix} ` };
  }
  const quote = target.evidence.quote;
  const swapped = quote.includes("five") ? quote.replace("five", "four") : `${quote.slice(0, -1)}?`;
  return {
    ...certificate,
    checkpoints: certificate.checkpoints.map((c) =>
      c.id === target.id && c.evidence ? { ...c, evidence: { ...c.evidence, quote: swapped } } : c,
    ),
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 px-5 py-8 sm:px-8 print:py-0">
      <header className="border-ink flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b-2 pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="shout text-3xl">CONSENT CERTIFICATE</h1>
          <p className="plate text-ink-soft mt-1">
            Saakshi · साक्षी · anyone can recompute this without trusting the seller
          </p>
        </div>
        <Link
          href="/"
          className="plate decoration-carnival shrink-0 underline decoration-2 underline-offset-4 print:hidden"
        >
          What is Saakshi
        </Link>
      </header>
      {children}
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="plate text-ink-soft self-center">{label}</dt>
      <dd className="border-b border-dashed border-[color-mix(in_srgb,var(--ink)_30%,transparent)] py-1">
        {children}
      </dd>
    </>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}
