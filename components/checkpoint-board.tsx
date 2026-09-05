"use client";

import { Badge } from "@/components/ui/badge";
import type { BoardState, CheckpointState, ViolationState } from "@/lib/session/board";
import { boardSummary } from "@/lib/session/board";
import type { SessionSetup } from "@/lib/session/keyterms";
import { formatClock } from "@/lib/session/transcript";

type Props = { board: BoardState | null; setup: SessionSetup };

export function CheckpointBoard({ board, setup }: Props) {
  if (!board) return null;
  const summary = boardSummary(board);
  return (
    <section aria-label="Checkpoint board" className="flex h-full flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium tracking-wide uppercase">Checkpoint board</h2>
        <p className="text-muted-foreground text-xs" data-testid="board-summary">
          {summary.met} of {summary.total} disclosures made, {summary.open} open{" "}
          {summary.open === 1 ? "flag" : "flags"}
        </p>
      </div>

      <ol className="flex flex-col gap-1.5">
        {board.checkpoints.map((c) => (
          <CheckpointRow key={c.id} c={c} setup={setup} />
        ))}
      </ol>

      <h3 className="mt-2 text-sm font-medium tracking-wide uppercase">Flags</h3>
      {board.violations.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="no-flags">
          No prohibited claims so far.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {board.violations.map((v) => (
            <ViolationRow key={v.key} v={v} setup={setup} />
          ))}
        </ol>
      )}

      {board.beliefs.length > 0 && (
        <div className="text-muted-foreground text-xs">
          <p className="font-medium">Customer beliefs to correct in teach-back</p>
          <ul className="list-disc pl-4">
            {board.beliefs.map((b) => (
              <li key={b.key}>
                {b.label} ({formatClock(b.evidence.startMs)}): {b.evidence.quote}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function CheckpointRow({ c, setup }: { c: CheckpointState; setup: SessionSetup }) {
  const met = c.status === "met";
  return (
    <li
      data-testid="checkpoint"
      data-id={c.id}
      data-status={c.status}
      className={`rounded-md border px-3 py-2 text-sm ${met ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className={met ? "text-emerald-700" : "text-muted-foreground"}>
          {met ? "✓" : "○"}
        </span>
        <span className="font-medium">{c.label}</span>
        <span className="text-muted-foreground ml-auto text-xs">{met ? "met" : "pending"}</span>
      </div>
      {met && c.evidence ? (
        <p className="text-muted-foreground mt-1 pl-5 text-xs">
          {formatClock(c.evidence.startMs)} {setup.advisorName}: &ldquo;{c.evidence.quote}&rdquo;
        </p>
      ) : (
        <p className="text-muted-foreground mt-1 pl-5 text-xs">{c.hint}</p>
      )}
      <p className="text-muted-foreground mt-0.5 pl-5 text-[11px]" title={c.citation.clause}>
        {c.citation.authority}, {c.citation.instrument}
      </p>
    </li>
  );
}

function ViolationRow({ v, setup }: { v: ViolationState; setup: SessionSetup }) {
  return (
    <li
      data-testid="violation"
      data-id={v.id}
      data-severity={v.severity}
      className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm dark:border-red-900 dark:bg-red-950/40"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={v.severity === "medium" ? "secondary" : "destructive"}>{v.severity}</Badge>
        <span className="font-medium">{v.label}</span>
        <span className="text-muted-foreground ml-auto text-xs">{v.status}</span>
      </div>
      <p className="mt-1 text-xs">
        {formatClock(v.evidence.startMs)} {setup.advisorName}: &ldquo;{v.evidence.quote}&rdquo;
      </p>
      <p className="text-muted-foreground mt-1 text-xs">Correction: {v.correction}</p>
      <p className="text-muted-foreground mt-0.5 text-[11px]" title={v.citation.clause}>
        {v.citation.authority}, {v.citation.instrument}
      </p>
      <p className="text-muted-foreground mt-0.5 font-mono text-[11px]" data-testid="latency-slot">
        intervention latency: {v.latencyMs !== undefined ? `${v.latencyMs} ms` : "n/a (Phase 2)"}
      </p>
    </li>
  );
}
