"use client";

import { CrossMark, SealMark } from "@/components/marks";
import { buttonVariants } from "@/components/ui/button";
import type { CertificateState } from "@/lib/session/store";

type Props = { certificate: CertificateState | undefined };

/**
 * The end of the demo: a stored certificate, its hash, and the link a judge opens to verify it.
 * The hash is shown in full because the point of the phase is that anyone can recompute it.
 * When the store is only in memory the card says so, because a link that works on this instance
 * and nowhere else is worse than no link at all if nobody is told.
 */
export function CertificateCard({ certificate }: Props) {
  if (!certificate) return null;

  if (certificate.status === "building") {
    return (
      <section className="card-print p-3 text-sm" data-testid="certificate-building">
        Writing the consent certificate.
      </section>
    );
  }

  if (certificate.status === "error") {
    return (
      <section className="card-print border-carnival p-3 text-sm" data-testid="certificate-error">
        <p className="font-display flex items-center gap-2">
          <CrossMark className="h-5 w-5 shrink-0" />
          The certificate could not be stored
        </p>
        <p className="text-ink-soft mt-1 text-xs">{certificate.error}</p>
        {certificate.payload !== undefined && (
          <div className="mt-2">
            <SaveButton certificate={certificate} />
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      aria-label="Consent certificate"
      className="card-print flex flex-col gap-2 p-3"
      data-testid="certificate-card"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display flex items-center gap-2 text-sm tracking-[0.06em] uppercase">
          <SealMark className="h-5 w-5 shrink-0" />
          Consent certificate
        </h2>
        <span
          className="num border-ink bg-sun rounded-sm border-2 px-1.5 py-0.5"
          data-testid="certificate-id"
        >
          {certificate.id}
        </span>
      </div>

      <p className="num text-ink-soft break-all" data-testid="certificate-hash">
        {certificate.hash}
      </p>

      {certificate.durable === false && (
        <p className="card-print-tight bg-sun px-2 py-1.5 text-xs" data-testid="certificate-local">
          <span className="plate">Stored in memory.</span> This link works on this server only, and
          not after a restart. Save the record to keep it, or provision the Redis store.
        </p>
      )}

      {certificate.url && (
        <div className="flex flex-wrap items-center gap-2">
          <a
            className={buttonVariants({ size: "sm" })}
            href={certificate.url}
            target="_blank"
            rel="noreferrer"
            data-testid="verify-link"
          >
            Open the verify page
          </a>
          <a
            className={buttonVariants({ size: "sm", variant: "secondary" })}
            href={`${certificate.url}?tamper=quote`}
            target="_blank"
            rel="noreferrer"
            data-testid="tamper-link"
          >
            Show a tampered copy
          </a>
          {certificate.payload !== undefined && <SaveButton certificate={certificate} />}
        </div>
      )}
    </section>
  );
}

/**
 * The record as a file. It is byte for byte what the server hashed, so a saved copy recomputes to
 * the same certificate hash the page shows.
 */
function SaveButton({ certificate }: { certificate: CertificateState }) {
  const save = () => {
    const json = JSON.stringify(certificate.payload, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `saakshi-certificate-${certificate.id ?? "record"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button
      type="button"
      onClick={save}
      className={buttonVariants({ size: "sm", variant: "outline" })}
      data-testid="certificate-download"
    >
      Save the record
    </button>
  );
}
