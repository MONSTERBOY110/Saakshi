import { Bean, CrossMark, EmptySquare } from "@/components/marks";
import type { CompiledPack } from "@/lib/rules/pack";

// The tabla before a word has been said, and the same tabla mid-conversation on the landing page.
// It is the real protocol pack in both places, never a mockup, so what a judge sees on the way in
// is exactly what fills up once the room starts.

const FIELDS = ["bg-turquoise", "bg-sun", "bg-rose", "bg-turquoise"];

type Props = {
  pack: CompiledPack;
  /** How many cards to show as already marked. Zero is the honest state before a session. */
  marked?: number;
  /** Show one card as called but unmarked, the disclosure nobody made. */
  missingAt?: number;
  caption?: string;
};

export function TablaPreview({ pack, marked = 0, missingAt, caption }: Props) {
  return (
    <ol className="card-print bg-sun grid w-full grid-cols-2 gap-2 border-[3px] p-2.5 sm:grid-cols-4">
      {pack.checkpoints.map((c, i) => (
        <li
          key={c.id}
          className={`border-ink relative flex aspect-3/4 flex-col justify-between border-2 p-1.5 ${
            i < marked ? (FIELDS[i % FIELDS.length] as string) : "bg-paper"
          }`}
          title={caption ? undefined : `${c.label}. ${c.citation.authority}.`}
        >
          <span className="num">{String(i + 1).padStart(2, "0")}</span>
          <span className="flex flex-1 items-center justify-center">
            {i < marked ? (
              <Bean className="h-10 w-10" title="Disclosed" />
            ) : i === missingAt ? (
              <CrossMark className="h-9 w-9" title="Not disclosed" />
            ) : (
              <EmptySquare className="h-9 w-9" title="Not said yet" />
            )}
          </span>
          <span className="plate text-center leading-[1.15]">{c.short_label ?? c.label}</span>
        </li>
      ))}
    </ol>
  );
}
