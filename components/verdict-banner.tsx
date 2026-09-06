// The verdict a reviewer came to see. Colour is never the only signal: the word, the symbol and
// the explanation all carry it (prd.md section 7, accessibility).

type Props = {
  verdict: "valid" | "tampered" | "not_found";
  id: string;
  chainOk?: boolean;
  hashOk?: boolean;
};

export function VerdictBanner({ verdict, id, chainOk, hashOk }: Props) {
  const style =
    verdict === "valid"
      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
      : verdict === "tampered"
        ? "border-red-500 bg-red-50 dark:bg-red-950/40"
        : "border-neutral-400 bg-neutral-50 dark:bg-neutral-900/50";
  const word = verdict === "valid" ? "VALID" : verdict === "tampered" ? "TAMPERED" : "NOT FOUND";
  const mark = verdict === "valid" ? "✓" : verdict === "tampered" ? "✕" : "?";

  return (
    <section
      data-testid="verdict"
      data-verdict={verdict}
      className={`rounded-lg border-2 px-4 py-3 ${style}`}
    >
      <p className="flex items-baseline gap-3">
        <span aria-hidden className="text-2xl leading-none">
          {mark}
        </span>
        <span className="text-2xl font-semibold tracking-tight">{word}</span>
        <span className="text-muted-foreground font-mono text-xs break-all">{id}</span>
      </p>
      <p className="mt-1 text-sm">
        {verdict === "valid" &&
          "Both proofs were recomputed from this page's own copy and both match. Nothing in this record has changed since it was issued."}
        {verdict === "tampered" &&
          "This record does not match its own proofs. Treat every claim on this page as unverified."}
        {verdict === "not_found" && "Nothing is stored under this identifier."}
      </p>
      {verdict === "tampered" && (
        <ul className="mt-2 text-xs">
          <li>Turn chain: {chainOk ? "matches" : "does not match the stored head"}</li>
          <li>Certificate hash: {hashOk ? "matches" : "does not match the stored body"}</li>
        </ul>
      )}
    </section>
  );
}
