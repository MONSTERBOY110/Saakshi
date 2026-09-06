import type { Metadata } from "next";
import { Bean, CrossMark, FlagMark, StarOrnament } from "@/components/marks";
import { getPack } from "@/lib/rules/load";

// The 16:9 submission cover, composed at 1920x1080 and captured by
// tests/e2e/readme-shots.live.spec.ts into docs/images/cover.png. It is a route rather than a
// drawing so it is built from the same tokens, marks and protocol pack as the product, and cannot
// drift from what a judge actually sees. Not linked from anywhere and not indexed.

export const metadata: Metadata = {
  title: "Saakshi cover",
  robots: { index: false, follow: false },
};

const FIELDS = ["bg-turquoise", "bg-sun", "bg-rose", "bg-turquoise"];

export default function CoverPage() {
  const pack = getPack("insurance-ulip-in");
  const marked = 5;

  return (
    <main
      className="bg-paper flex flex-col justify-between overflow-hidden"
      style={{ width: 1920, height: 1080, padding: "48px 72px" }}
    >
      <header className="border-ink flex items-center justify-between border-b-4 pb-5">
        <div className="flex items-baseline gap-5">
          <span className="shout text-[64px] leading-none">SAAKSHI</span>
          <span className="plate text-ink-soft text-[20px] tracking-[0.14em]">
            साक्षी · the witness
          </span>
        </div>
        <span className="ribbon text-[20px]">
          <StarOrnament className="h-5 w-5" />
          Consent you can prove
        </span>
      </header>

      <div className="flex items-center gap-14">
        <div className="flex min-w-0 flex-1 flex-col gap-7">
          <h1 className="shout text-[106px] leading-[0.9]">
            IT CALLS
            <br />
            THE CLAIM.
            <br />
            <span className="text-carnival">OUT LOUD.</span>
          </h1>
          <p className="max-w-[26ch] text-[25px] leading-snug">
            An AI witness for regulated sales. It knows who said what in English or Hinglish, and
            interrupts a mis-selling claim while it is still in the air.
          </p>
        </div>

        <figure className="flex shrink-0 flex-col items-center gap-4" style={{ width: 620 }}>
          <div className="card-print border-carnival w-full border-[5px] p-4">
            <div className="border-carnival bg-turquoise border-[3px] p-5">
              <div className="flex items-start justify-between">
                <span className="num border-ink bg-paper rounded-sm border-[3px] px-2 py-1 text-[20px]">
                  04
                </span>
                <FlagMark className="h-12 w-12" title="Prohibited claim" />
              </div>
              <p className="font-display mt-4 text-[29px] leading-tight text-[#fff8e8]">
                &ldquo;Anytime, madam, and the returns are guaranteed, twelve percent.&rdquo;
              </p>
              <p className="plate border-carnival mt-4 border-t-[3px] pt-2 text-center text-[17px] text-[#fff8e8]">
                Guaranteed returns · critical · answered in 1368 ms
              </p>
            </div>
          </div>

          <ol className="card-print bg-sun grid w-full grid-cols-4 gap-2 border-[4px] p-2">
            {pack.checkpoints.map((c, i) => (
              <li
                key={c.id}
                className={`border-ink flex aspect-3/4 flex-col justify-between border-[3px] p-2 ${
                  i < marked ? (FIELDS[i % FIELDS.length] as string) : "bg-paper"
                }`}
              >
                <span className="num text-[15px]">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex flex-1 items-center justify-center">
                  {i < marked ? (
                    <Bean className="h-10 w-10" title="Disclosed" />
                  ) : (
                    <CrossMark className="h-9 w-9" title="Not disclosed" />
                  )}
                </span>
                <span className="plate text-center text-[12px] leading-[1.12]">
                  {c.short_label ?? c.label}
                </span>
              </li>
            ))}
          </ol>
        </figure>
      </div>

      <footer className="rule-dashed flex items-end justify-between gap-8 pt-5">
        <p className="text-ink-soft max-w-[64ch] text-[19px] leading-snug">
          Every disclosure the regulator requires is a card, marked the moment it is genuinely said,
          with the quote and the clock time that prove it. The session ends in a hash-chained
          certificate anyone can verify.
        </p>
        <p className="plate text-ink-soft shrink-0 text-right text-[18px] leading-relaxed">
          AssemblyAI Voice Agent API
          <br />
          Universal-3.5 Pro streaming, diarized
        </p>
      </footer>
    </main>
  );
}
