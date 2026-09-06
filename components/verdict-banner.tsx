import { Bean, CrossMark, EmptySquare, SealMark } from "@/components/marks";

// The verdict a reviewer came to see. Colour is never the only signal: a drawn mark, the word, and
// a sentence of plain explanation all carry it independently (prd.md section 7). VALID is the seal;
// TAMPERED is the crossed square, and it is the only red on this page.

type Props = {
  verdict: "valid" | "tampered" | "not_found";
  id: string;
  chainOk?: boolean;
  hashOk?: boolean;
};

export function VerdictBanner({ verdict, id, chainOk, hashOk }: Props) {
  const field =
    verdict === "valid" ? "bg-turquoise" : verdict === "tampered" ? "bg-carnival" : "bg-paper-deep";
  const onField = verdict === "not_found" ? "text-ink" : "text-[#fff8e8]";
  const word = verdict === "valid" ? "VALID" : verdict === "tampered" ? "TAMPERED" : "NOT FOUND";

  return (
    <section
      data-testid="verdict"
      data-verdict={verdict}
      className="card-print flex flex-wrap items-stretch border-[3px]"
    >
      <div className={`border-ink flex items-center gap-3 border-r-2 px-4 py-3 ${field}`}>
        {verdict === "valid" ? (
          <SealMark className="h-10 w-10 shrink-0" title="Verified" />
        ) : verdict === "tampered" ? (
          <CrossMark className="h-10 w-10 shrink-0" title="Does not match its proofs" />
        ) : (
          <EmptySquare className="h-10 w-10 shrink-0" title="Nothing stored" />
        )}
        <span className={`shout text-3xl ${onField}`}>{word}</span>
      </div>

      <div className="min-w-0 flex-1 px-4 py-3">
        <p className="num text-ink-soft break-all">{id}</p>
        <p className="mt-1 max-w-[62ch] text-sm leading-relaxed">
          {verdict === "valid" &&
            "Both proofs were recomputed from this page's own copy of the record, and both match. Nothing here has changed since the conversation ended."}
          {verdict === "tampered" &&
            "This record does not match its own proofs. Treat every claim on this page as unverified."}
          {verdict === "not_found" && "Nothing is stored under this identifier."}
        </p>
        {verdict === "tampered" && (
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            <Proof ok={chainOk} label="Turn chain" bad="does not match the stored head" />
            <Proof ok={hashOk} label="Certificate hash" bad="does not match the stored body" />
          </ul>
        )}
      </div>
    </section>
  );
}

function Proof({ ok, label, bad }: { ok?: boolean; label: string; bad: string }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <Bean className="h-4 w-4 shrink-0" title="matches" />
      ) : (
        <CrossMark className="h-4 w-4 shrink-0" title="does not match" />
      )}
      <span>
        <span className="plate">{label}</span> {ok ? "matches" : bad}
      </span>
    </li>
  );
}
