"use client";

import { Badge } from "@/components/ui/badge";
import type { SessionSetup } from "@/lib/session/keyterms";
import type { TeachbackAnswer, TeachbackState, TeachbackVerdict } from "@/lib/session/store";
import { formatClock } from "@/lib/session/transcript";

type Props = { teachback: TeachbackState | undefined; setup: SessionSetup };

// Colour is never the only signal: every verdict carries a symbol and a word as well, so the panel
// reads the same to a judge watching a projector or a colour-blind reviewer.
const VERDICT: Record<TeachbackVerdict, { symbol: string; word: string; className: string }> = {
  understood: {
    symbol: "✓",
    word: "Understood",
    className: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  },
  partial: {
    symbol: "≈",
    word: "Partly",
    className: "border-amber-600/40 text-amber-700 dark:text-amber-400",
  },
  not_understood: {
    symbol: "✗",
    word: "Not understood",
    className: "border-red-600/40 text-red-700 dark:text-red-400",
  },
};

export function TeachbackPanel({ teachback, setup }: Props) {
  if (!teachback) return null;
  const { questions, answers } = teachback;
  const answered = new Map(answers.map((a) => [a.questionId, a]));

  return (
    <section aria-label="Teach-back" className="flex flex-col gap-3" data-testid="teachback-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium tracking-wide uppercase">
          Teach-back with {setup.customerName}
        </h2>
        <p className="text-muted-foreground text-xs" data-testid="teachback-progress">
          {answers.length} of {questions.length} answered
        </p>
      </div>

      {teachback.status === "loading" && (
        <p className="text-muted-foreground text-sm" data-testid="teachback-loading">
          Preparing questions from what was actually said.
        </p>
      )}

      {teachback.error && (
        <p className="text-muted-foreground text-xs" data-testid="teachback-error">
          Questions came from the protocol pack: {teachback.error}
        </p>
      )}

      <ol className="flex flex-col gap-2">
        {questions.map((q, i) => {
          const answer = answered.get(q.id);
          const current = !answer && answers.length === i;
          return (
            <li
              key={q.id}
              data-testid={`teachback-q-${q.id}`}
              data-verdict={answer?.verdict ?? "pending"}
              className={`rounded-md border p-2.5 text-sm ${current ? "border-foreground/40" : "border-border"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">
                  {i + 1}. {q.question}
                </p>
                <VerdictChip answer={answer} current={current} />
              </div>
              {q.hintHi && !answer && (
                <p className="text-muted-foreground mt-1 text-xs">{q.hintHi}</p>
              )}
              {answer && <AnswerBody answer={answer} />}
            </li>
          );
        })}
      </ol>

      {teachback.advisorInterjections > 0 && (
        <p className="text-muted-foreground text-xs" data-testid="advisor-interjections">
          {setup.advisorName} answered for {setup.customerName}{" "}
          {teachback.advisorInterjections === 1
            ? "once"
            : `${teachback.advisorInterjections} times`}
          , and was asked to let her speak.
        </p>
      )}

      {teachback.summary && (
        <p className="text-muted-foreground text-xs" data-testid="teachback-summary">
          {teachback.summary}
        </p>
      )}
    </section>
  );
}

function VerdictChip({ answer, current }: { answer?: TeachbackAnswer; current: boolean }) {
  if (!answer) {
    return (
      <Badge variant="outline" className="shrink-0 text-xs">
        {current ? "Asking now" : "To come"}
      </Badge>
    );
  }
  const v = VERDICT[answer.verdict];
  return (
    <Badge
      variant="outline"
      className={`shrink-0 text-xs ${v.className}`}
      data-testid={`verdict-${answer.questionId}`}
    >
      <span aria-hidden="true">{v.symbol}</span> {v.word}
    </Badge>
  );
}

function AnswerBody({ answer }: { answer: TeachbackAnswer }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <p className="text-muted-foreground text-xs">
        {answer.evidence && <span>{formatClock(answer.evidence.start_ms)} </span>}
        <q>{answer.customerQuote}</q>
      </p>
      {answer.reexplained && (
        <p
          className="text-muted-foreground text-xs"
          data-testid={`reexplained-${answer.questionId}`}
        >
          Saakshi explained this again before she answered.
        </p>
      )}
    </div>
  );
}
