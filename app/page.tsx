import Link from "next/link";
import { CallerHorn, FlagMark, StarOrnament } from "@/components/marks";
import { TablaPreview } from "@/components/tabla-preview";
import { getPack } from "@/lib/rules/load";

// The landing page is the game explained by playing it: the called card is a real line from the
// demo script, the tabla is the real Checkpoint Board from the real protocol pack, and the flag is
// the real prohibited claim. Nothing here is a mockup of the product; it is the product's own data.

export default function Home() {
  const pack = getPack("insurance-ulip-in");
  const called = pack.demo_script.find((l) => l.id === "d04") ?? pack.demo_script[0];

  return (
    <main className="mx-auto max-w-[86rem] px-5 py-6 sm:px-8">
      <header className="border-ink flex flex-wrap items-center justify-between gap-4 border-b-2 pb-4">
        <div className="flex items-baseline gap-3">
          <span className="shout text-3xl">SAAKSHI</span>
          <span className="plate text-ink-soft">साक्षी · the witness</span>
        </div>
        <nav className="flex items-center gap-2">
          <span className="ribbon ribbon-quiet">Consent you can prove</span>
        </nav>
      </header>

      <section className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-12">
        <div className="flex flex-col gap-6 lg:pt-2">
          <h1 className="shout text-[clamp(2.75rem,8vw,5.5rem)]">
            IT CALLS
            <br />
            THE CLAIM.
            <br />
            <span className="text-carnival">OUT LOUD.</span>
          </h1>

          <div className="flex items-start gap-3">
            <StarOrnament className="mt-1.5 h-4 w-4 shrink-0" />
            <p className="max-w-[62ch] text-lg leading-relaxed">
              Saakshi sits between an advisor and a customer, knows who said what in English or
              Hinglish, and interrupts a mis-selling claim while it is still in the air. It ends by
              issuing a certificate anyone can check without trusting the seller.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/session"
              className="card-print bg-carnival font-display inline-flex items-center gap-2 px-6 py-3 text-sm tracking-[0.08em] text-[#fff8e8] uppercase transition-transform hover:-translate-y-0.5 active:translate-y-0"
            >
              <CallerHorn className="h-5 w-5" />
              Open the room
            </Link>
            <span className="text-ink-soft text-sm">
              One person can run the whole demo. The advisor is played for you.
            </span>
          </div>

          <dl className="rule-dashed grid grid-cols-2 gap-x-6 gap-y-3 pt-5 sm:grid-cols-3">
            <Stat value="1.5 s" label="Median time to interrupt" />
            <Stat value="8 of 8" label="Disclosures tracked live" />
            <Stat value="SHA-256" label="Chained over every turn" />
          </dl>
        </div>

        <div className="flex flex-col gap-6">
          <CalledCard text={called?.text_display ?? ""} />
          <Tabla pack={pack} />
        </div>
      </section>

      <section className="rule-dashed grid gap-6 pt-8 md:grid-cols-3">
        <Rule
          n="01"
          title="It hears two people"
          body="Diarized streaming speech recognition tells the advisor from the customer, in English, Hindi, or a sentence that switches halfway."
        />
        <Rule
          n="02"
          title="It marks the tabla"
          body="Every required disclosure is a card. It gets a bean the moment it is actually said, with the quote and the clock time that prove it."
        />
        <Rule
          n="03"
          title="It calls the foul"
          body="A prohibited claim is flagged and spoken over, in under twenty words, before the customer has time to believe it."
        />
      </section>

      <footer className="rule-dashed text-ink-soft mt-10 flex flex-wrap items-center justify-between gap-4 pt-5 pb-8 text-sm">
        <p>
          Built on AssemblyAI Streaming STT, the Voice Agent API and the LLM Gateway. No audio is
          ever stored: quotes, timestamps and hashes only.
        </p>
        <Link
          href="/session"
          className="font-display decoration-carnival text-xs tracking-[0.08em] uppercase underline decoration-2 underline-offset-4"
        >
          Open the room
        </Link>
      </footer>
    </main>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="plate text-ink-soft">{label}</dt>
      <dd className="font-display tabular text-2xl">{value}</dd>
    </div>
  );
}

/** The caller's card: what was just said in the room, pinned where everyone can see it. */
function CalledCard({ text }: { text: string }) {
  return (
    <figure className="flex flex-col items-center gap-3">
      <figcaption className="ribbon">
        <StarOrnament className="h-3 w-3" />
        The called card
      </figcaption>
      <div className="card-print w-full max-w-sm border-[3px] p-3">
        <div className="border-carnival bg-turquoise border-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <span className="num border-ink bg-paper rounded-sm border-2 px-1.5 py-0.5">04</span>
            <FlagMark className="h-7 w-7" title="Prohibited claim" />
          </div>
          <p className="font-display mt-6 mb-8 text-[1.35rem] leading-tight text-[#fff8e8]">
            &ldquo;{text}&rdquo;
          </p>
          <p className="plate border-carnival border-t-2 pt-2 text-center text-[#fff8e8]">
            Guaranteed returns · critical
          </p>
        </div>
        <p className="text-ink-soft mt-3 text-center text-sm leading-snug">
          Saakshi answers in 1.5 seconds: returns on a market-linked plan cannot be called
          guaranteed.
        </p>
      </div>
    </figure>
  );
}

/** The tabla: the real protocol pack, as the grid a room fills in whatever order it is dealt. */
function Tabla({ pack }: { pack: ReturnType<typeof getPack> }) {
  return (
    <figure className="flex flex-col items-center gap-3">
      <figcaption className="ribbon ribbon-quiet">The tabla, mid conversation</figcaption>
      <TablaPreview pack={pack} marked={5} missingAt={5} />
      <p className="text-ink-soft text-center text-xs">
        Five made, one missing, two still to come. The missing one is what Saakshi reads back before
        the customer signs.
      </p>
    </figure>
  );
}

function Rule({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <article className="flex gap-3">
      <span className="num border-ink bg-paper mt-1 h-min shrink-0 rounded-sm border-2 px-1.5 py-0.5">
        {n}
      </span>
      <div>
        <h2 className="font-display text-lg">{title}</h2>
        <p className="text-ink-soft mt-1 max-w-[52ch] text-sm leading-relaxed">{body}</p>
      </div>
    </article>
  );
}
