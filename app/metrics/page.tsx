import type { Metadata } from "next";
import Link from "next/link";
import { Bean, CrossMark, StarOrnament } from "@/components/marks";
import measurements from "@/eval/measurements.json";
import report from "@/eval/report.json";
import type { EvalReport } from "@/lib/eval/corpus";

// The numbers, with the command that produced each one (prd.md P1-2). Nothing here is typed in by
// hand except the live measurements, and those carry their method and the command to reproduce them.

export const metadata: Metadata = {
  title: "Saakshi: how well it works",
  description:
    "Precision and recall of the Saakshi rule engine against a labelled corpus, and the live latency measurements, each with the command that produced it.",
};

type Measurement = {
  id: string;
  label: string;
  value: string;
  detail: string;
  method: string;
  command: string;
  measured_on: string;
};

const evalReport = report as unknown as EvalReport;
const live = measurements as { note: string; measurements: Measurement[] };

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

export default function MetricsPage() {
  const rules = evalReport.layers.find((l) => l.layer === "rules");

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 sm:px-8">
      <header className="border-ink flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b-2 pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="shout text-3xl">HOW WELL IT WORKS</h1>
          <p className="plate text-ink-soft mt-1">
            Every number below carries the command that produced it
          </p>
        </div>
        <Link
          href="/"
          className="plate decoration-carnival shrink-0 underline decoration-2 underline-offset-4"
        >
          What is Saakshi
        </Link>
      </header>

      <section aria-label="Live measurements" className="flex flex-col gap-3">
        <h2 className="ribbon self-start">
          <StarOrnament className="h-3 w-3" />
          Measured against the live APIs
        </h2>
        <ol className="flex flex-col gap-2">
          {live.measurements.map((m) => (
            <li key={m.id} className="card-print flex flex-wrap items-stretch">
              <div className="border-ink bg-sun flex min-w-[9rem] flex-col justify-center border-r-2 px-3 py-2">
                <span className="font-display tabular text-xl leading-none">{m.value}</span>
                <span className="plate text-ink-soft mt-1">{m.measured_on || "not yet"}</span>
              </div>
              <div className="min-w-0 flex-1 px-3 py-2">
                <p className="font-display text-base leading-snug">{m.label}</p>
                <p className="text-ink-soft mt-0.5 text-sm leading-relaxed">{m.detail}</p>
                <p className="text-ink-soft mt-1 text-xs leading-relaxed">{m.method}</p>
                {m.command && <p className="num mt-1">{m.command}</p>}
              </div>
            </li>
          ))}
        </ol>
        <p className="text-ink-soft max-w-[70ch] text-xs leading-relaxed">{live.note}</p>
      </section>

      {rules && (
        <section aria-label="Rule engine accuracy" className="flex flex-col gap-3">
          <h2 className="ribbon ribbon-quiet self-start">
            The rule engine against a labelled corpus
          </h2>

          <div className="card-print overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-ink bg-paper-deep border-b-2">
                  <Th>What</Th>
                  <Th>Precision</Th>
                  <Th>Recall</Th>
                  <Th>F1</Th>
                  <Th>Found</Th>
                  <Th>Wrongly flagged</Th>
                  <Th>Missed</Th>
                </tr>
              </thead>
              <tbody>
                <Row name="Prohibited claims" s={rules.violations} />
                <Row name="Required disclosures" s={rules.checkpoints} />
              </tbody>
            </table>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Fact label="Labelled turns" value={String(evalReport.corpus.turns)} />
            {Object.entries(evalReport.corpus.packs).map(([pack, n]) => (
              <Fact key={pack} label={pack} value={String(n)} />
            ))}
            <Fact
              label="Disagreements"
              value={String(rules.wrong.length)}
              mark={rules.wrong.length === 0 ? "bean" : "cross"}
            />
          </dl>

          <p className="text-ink-soft max-w-[70ch] text-xs leading-relaxed">
            Read this as a regression suite, not as an unbiased estimate of how the engine behaves
            on unseen speech. The corpus was labelled first, by hand, from each sentence alone. The
            engine then disagreed on eighteen of them, nine patterns were genuinely wrong and were
            fixed, and one label was too strict and was corrected. A score of{" "}
            {pct(rules.violations.f1)} means the patterns now agree with those labels, and that a
            future edit which breaks one of them will be caught. It does not mean the next unseen
            sentence will be handled correctly.
          </p>
          <p className="num text-ink-soft">pnpm eval · report written to eval/report.json</p>
        </section>
      )}

      <section className="rule-dashed flex flex-col gap-2 pt-4">
        <h2 className="ribbon ribbon-quiet self-start">What is not measured</h2>
        <ul className="text-ink-soft flex max-w-[70ch] list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
          <li>
            Teach-back answer recording has never run against a live human. The tools and the guards
            are unit tested, and the golden recording cannot exercise them.
          </li>
          <li>
            Diarization accuracy is measured on synthetic voices only. A real two-person session is
            still owed.
          </li>
          <li>Firefox and Safari are untested. Chromium is the supported browser today.</li>
          <li>Cost per session has not been read off the dashboard yet.</li>
        </ul>
      </section>
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="plate text-ink-soft px-3 py-2 text-left">{children}</th>;
}

function Row({
  name,
  s,
}: {
  name: string;
  s: { precision: number; recall: number; f1: number; tp: number; fp: number; fn: number };
}) {
  return (
    <tr className="border-b border-dashed border-[color-mix(in_srgb,var(--ink)_30%,transparent)] last:border-b-0">
      <td className="px-3 py-2 font-medium">{name}</td>
      <td className="num px-3 py-2">{pct(s.precision)}</td>
      <td className="num px-3 py-2">{pct(s.recall)}</td>
      <td className="num px-3 py-2">{pct(s.f1)}</td>
      <td className="num px-3 py-2">{s.tp}</td>
      <td className="num px-3 py-2">{s.fp}</td>
      <td className="num px-3 py-2">{s.fn}</td>
    </tr>
  );
}

function Fact({ label, value, mark }: { label: string; value: string; mark?: "bean" | "cross" }) {
  return (
    <div>
      <dt className="plate text-ink-soft">{label}</dt>
      <dd className="font-display tabular flex items-center gap-1.5 text-lg">
        {mark === "bean" && <Bean className="h-4 w-4" title="none" />}
        {mark === "cross" && <CrossMark className="h-4 w-4" title="some" />}
        {value}
      </dd>
    </div>
  );
}
