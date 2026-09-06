"use client";

import { Bean, BeanHalf, CrossMark, StarOrnament } from "@/components/marks";
import type { SessionSetup } from "@/lib/session/keyterms";
import type { TeachbackAnswer, TeachbackState, TeachbackVerdict } from "@/lib/session/store";
import { formatClock } from "@/lib/session/transcript";

type Props = { teachback: TeachbackState | undefined; setup: SessionSetup };

// The customer's answers are marked with the same objects the tabla uses: a whole bean when she
// covered it, half a bean when she got part of it, a crossed square when she could not. Colour is
// never the only signal, so every mark ships beside its word.
const VERDICT: Record<TeachbackVerdict, { Mark: typeof Bean; word: string; className: string }> = {
  understood: {
    Mark: Bean,
    word: "Understood",
    className: "border-ink bg-turquoise text-[#fff8e8]",
  },
  partial: {
    Mark: BeanHalf,
    word: "Partly",
    className: "border-ink bg-sun text-ink",
  },
  not_understood: {
    Mark: CrossMark,
    word: "Not understood",
    className: "border-ink bg-carnival text-[#fff8e8]",
  },
};

export function TeachbackPanel({ teachback, setup }: Props) {
  if (!teachback) return null;
  const { questions, answers } = teachback;
  const answered = new Map(answers.map((a) => [a.questionId, a]));

  return (
    <section aria-label="Teach-back" className="flex flex-col gap-3" data-testid="teachback-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="ribbon">
          <StarOrnament className="h-3 w-3" />
          Teach-back with {setup.customerName}
        </h2>
        <p className="text-ink-soft text-xs" data-testid="teachback-progress">
          {answers.length} of {questions.length} answered
        </p>
      </div>

      {teachback.status === "loading" && (
        <p className="text-ink-soft text-sm" data-testid="teachback-loading">
          Preparing questions from what was actually said.
        </p>
      )}

      {teachback.error && (
        <p className="text-ink-soft text-xs" data-testid="teachback-error">
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
              className={`card-print-tight p-2.5 text-sm ${current ? "border-foreground/40" : "border-border"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">
                  {i + 1}. {q.question}
                </p>
                <VerdictChip answer={answer} current={current} />
              </div>
              {q.hintHi && !answer && <p className="text-ink-soft mt-1 text-xs">{q.hintHi}</p>}
              {answer && <AnswerBody answer={answer} />}
            </li>
          );
        })}
      </ol>

      {teachback.advisorInterjections > 0 && (
        <p className="text-ink-soft text-xs" data-testid="advisor-interjections">
          {setup.advisorName} answered for {setup.customerName}{" "}
          {teachback.advisorInterjections === 1
            ? "once"
            : `${teachback.advisorInterjections} times`}
          , and was asked to let her speak.
        </p>
      )}

      {teachback.summary && (
        <p className="text-ink-soft text-xs" data-testid="teachback-summary">
          {teachback.summary}
        </p>
      )}
    </section>
  );
}

function VerdictChip({ answer, current }: { answer?: TeachbackAnswer; current: boolean }) {
  if (!answer) {
    return (
      <span className="num border-ink bg-paper shrink-0 rounded-sm border-2 px-1.5 py-0.5">
        {current ? "Asking now" : "To come"}
      </span>
    );
  }
  const v = VERDICT[answer.verdict];
  return (
    <span
      className={`num flex shrink-0 items-center gap-1 rounded-sm border-2 px-1.5 py-0.5 ${v.className}`}
      data-testid={`verdict-${answer.questionId}`}
    >
      <v.Mark className="h-3.5 w-3.5" />
      {v.word}
    </span>
  );
}

function AnswerBody({ answer }: { answer: TeachbackAnswer }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <p className="text-ink-soft text-xs">
        {answer.evidence && <span>{formatClock(answer.evidence.start_ms)} </span>}
        <q>{answer.customerQuote}</q>
      </p>
      {answer.reexplained && (
        <p className="text-ink-soft text-xs" data-testid={`reexplained-${answer.questionId}`}>
          Saakshi explained this again before she answered.
        </p>
      )}
    </div>
  );
}
