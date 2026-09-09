import type { Certificate } from "@/lib/cert/schema";
import { Bean, EmptySquare } from "@/components/marks";

// Every claim on the certificate links to a speaker, a time and the words that were said
// (prd.md principle 2: speaker-attributed or it did not happen).

export function EvidenceTable({ certificate }: { certificate: Certificate }) {
  const met = certificate.checkpoints.filter((c) => c.status !== "missing").length;
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="ribbon ribbon-quiet mb-2">
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
                  <span className="text-ink-soft block text-xs">
                    {c.citation.authority}, {c.citation.clause}
                  </span>
                </Td>
                <Td>
                  {c.status === "missing" ? (
                    <EmptySquare className="mr-1 inline-block h-3.5 w-3.5 align-[-2px]" />
                  ) : (
                    <Bean className="mr-1 inline-block h-3.5 w-3.5 align-[-2px]" />
                  )}
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
        <h2 className="ribbon ribbon-quiet mb-2">
          Flagged claims ({certificate.violations.length})
        </h2>
        {certificate.violations.length === 0 ? (
          <p className="text-ink-soft text-sm">No prohibited claim was detected.</p>
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
                    <span className="text-ink-soft block text-xs">
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
        <h2 className="ribbon ribbon-quiet mb-2">
          Teach-back ({certificate.teachback.length} questions)
        </h2>
        {certificate.teachback.length === 0 ? (
          <p className="text-ink-soft text-sm">No teach-back was recorded.</p>
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

      {certificate.analyzer_notes && certificate.analyzer_notes.length > 0 && (
        <section>
          <h2 className="ribbon ribbon-quiet mb-2">
            Analyzer notes ({certificate.analyzer_notes.length}), not evidence
          </h2>
          <p className="text-ink-soft mb-2 text-xs">
            What the language model thought it heard. Nothing here ticked a disclosure, flagged a
            claim or was spoken. It is kept so a reviewer can check it against the quotes above.
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {certificate.analyzer_notes.map((n) => (
              <li key={`${n.kind}-${n.id}-${n.turn_order}`} data-testid="cert-note" data-id={n.id}>
                <span className="plate">{n.kind === "prohibited" ? "claim?" : "disclosure?"}</span>{" "}
                {n.label} (confidence {n.confidence.toFixed(2)}): &ldquo;{n.quote}&rdquo;
                {n.rationale ? (
                  <span className="text-ink-soft block text-xs">{n.rationale}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="plate text-ink-soft py-1 pr-3 text-left">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-2 pr-3 ${className}`}>{children}</td>;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
