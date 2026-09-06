"use client";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { CertificateState } from "@/lib/session/store";

type Props = { certificate: CertificateState | undefined };

/**
 * The end of the demo: a stored certificate, its hash, and the link a judge opens to verify it.
 * The hash is shown in full because the point of the phase is that anyone can recompute it.
 */
export function CertificateCard({ certificate }: Props) {
  if (!certificate) return null;

  if (certificate.status === "building") {
    return (
      <section className="rounded-md border p-3 text-sm" data-testid="certificate-building">
        Writing the consent certificate.
      </section>
    );
  }

  if (certificate.status === "error") {
    return (
      <section
        className="rounded-md border border-red-600/40 p-3 text-sm"
        data-testid="certificate-error"
      >
        <p className="font-medium">The certificate could not be stored</p>
        <p className="text-muted-foreground mt-1 text-xs">{certificate.error}</p>
      </section>
    );
  }

  return (
    <section
      aria-label="Consent certificate"
      className="flex flex-col gap-2 rounded-md border p-3"
      data-testid="certificate-card"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium tracking-wide uppercase">Consent certificate</h2>
        <Badge variant="outline" data-testid="certificate-id">
          {certificate.id}
        </Badge>
      </div>
      <p
        className="text-muted-foreground font-mono text-xs break-all"
        data-testid="certificate-hash"
      >
        {certificate.hash}
      </p>
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
        </div>
      )}
    </section>
  );
}
