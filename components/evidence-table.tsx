import type { Certificate } from "@/lib/cert/schema";

// Every claim on the certificate links to a speaker, a time and the words that were said
// (prd.md principle 2: speaker-attributed or it did not happen).

export function EvidenceTable({ certificate }: { certificate: Certificate }) {
  const met = certificate.checkpoints.filter((c) => c.status !== "missing").length;
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-2 text-sm font-medium tracking-wide uppercase">
          Required disclosures ({met} of {certificate.checkpoints.length})
        </h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <Th>Disclosure</Th>
              <Th>Status</Th>
              <Th>Said at</Th>
              <Th>Evidence</Th>
            </tr>
          </thead>
          <tbody>
            {certificate.checkpoints.map((c) => (
              <tr
                key={c.id}
                data-testid="cert-checkpoint"
                data-id={c.id}
                className="border-b align-top"
              >
                <Td>
                  {c.label}
                  <span className="text-muted-foreground block text-xs">
                    {c.citation.authority}, {c.citation.clause}
                  </span>
                </Td>
                <Td>
                  <span aria-hidden>{c.status === "missing" ? "○ " : "✓ "}</span>
                  {c.status === "met_after_nudge" ? "met after prompt" : c.status}
                </Td>
                <Td className="font-mono text-xs">
                  {c.evidence ? clock(c.evidence.start_ms) : "-"}
                </Td>
                <Td>{c.evidence ? `“${c.evidence.quote}”` : "not mentioned"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium tracking-wide uppercase">
          Flagged claims ({certificate.violations.length})
        </h2>
        {certificate.violations.length === 0 ? (
          <p className="text-muted-foreground text-sm">No prohibited claim was detected.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <Th>Claim</Th>
                <Th>Severity</Th>
                <Th>Said at</Th>
                <Th>Evidence and outcome</Th>
              </tr>
            </thead>
            <tbody>
              {certificate.violations.map((v) => (
                <tr
                  key={`${v.id}-${v.evidence.turn_order}`}
                  data-testid="cert-violation"
                  data-id={v.id}
                  className="border-b align-top"
                >
                  <Td>
                    {v.label}
                    <span className="text-muted-foreground block text-xs">
                      {v.citation.authority}, {v.citation.clause}
                    </span>
                  </Td>
                  <Td>{v.severity}</Td>
                  <Td className="font-mono text-xs">{clock(v.evidence.start_ms)}</Td>
                  <Td>
                    “{v.evidence.quote}”
                    <span className="block text-xs">
                      {v.intervention
                        ? `Saakshi said: “${v.intervention.spoken_text}”${
                            v.intervention.latency_ms !== undefined
                              ? ` after ${v.intervention.latency_ms} ms`
                              : ""
                          }. `
                        : ""}
                      Outcome: {v.resolution}.
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium tracking-wide uppercase">
          Teach-back ({certificate.teachback.length} questions)
        </h2>
        {certificate.teachback.length === 0 ? (
          <p className="text-muted-foreground text-sm">No teach-back was recorded.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <Th>Question</Th>
                <Th>Verdict</Th>
                <Th>The customer&rsquo;s own words</Th>
              </tr>
            </thead>
            <tbody>
              {certificate.teachback.map((t) => (
                <tr
                  key={t.question_id}
                  data-testid="cert-teachback"
                  data-verdict={t.verdict}
                  className="border-b align-top"
                >
                  <Td>{t.question}</Td>
                  <Td>
                    {t.verdict.replace("_", " ")}
                    {t.reexplained ? ", after a re-explanation" : ""}
                  </Td>
                  <Td>“{t.customer_quote}”</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-muted-foreground py-1 pr-3 text-xs font-medium uppercase">{children}</th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-2 pr-3 ${className}`}>{children}</td>;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
