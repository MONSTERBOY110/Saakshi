import { ACK_INTERVENTION_TOOL } from "@/lib/aai/tools";
import { getPack } from "@/lib/rules/load";
import { acknowledgeViolation, markNudged, setViolationLatency } from "./board";
import type { RoomController } from "./controller";
import { ALL_COVERED_LINE, ACK_WINDOW_MS, composeIntervention, composeNudge } from "./intervention";
import type { Intervention } from "./fusion";

// INTERVENE and NUDGE flows (prd.md P0-5, P0-6; trd.md section 2). Every spoken line is composed
// client-side and delivered through reply.create; the agent never improvises.

/**
 * Speak the pack's correction for a confirmed violation, open the acknowledgement window, and
 * return to OBSERVE when the advisor acknowledges or eight seconds pass.
 */
export function startIntervention(
  c: RoomController,
  i: Intervention,
  detectedAt: number,
  sttLagMs?: number,
): void {
  const board = c.state.board;
  const definition = board?.definitions[i.id];
  if (!definition || !c.dispatch({ type: "INTERVENE_START" })) return;

  const key = `${i.id}@${i.turnOrder}`;
  const line = composeIntervention(c.state.setup, definition.correction);
  c.pendingIntervention = { key, detectedAt, sttLagMs };
  c.set({
    intervention: {
      key,
      id: i.id,
      label: definition.label,
      severity: i.severity,
      source: i.source,
      spokenText: line,
      quote: i.quote,
      acknowledged: false,
      startedAt: detectedAt,
      sttLagMs,
    },
  });
  c.log("client", "intervention.start", { key, source: i.source, line, quote: i.quote });

  // The advisor may answer by voice during the window, so the agent needs the ack tool and the mic.
  c.mouth?.setTools([ACK_INTERVENTION_TOOL]);
  c.speakExact(line);

  c.clearAckTimer();
  c.ackTimer = setTimeout(() => endIntervention(c, "timeout"), ACK_WINDOW_MS + 4000);
}

export function acknowledgeIntervention(c: RoomController, note: string, byTool: boolean): void {
  const active = c.state.intervention;
  if (!active || active.acknowledged) return;
  c.log("client", "intervention.acknowledged", { key: active.key, note, byTool });
  c.set((s) => ({
    intervention: s.intervention ? { ...s.intervention, acknowledged: true, note } : s.intervention,
    board: s.board ? acknowledgeViolation(s.board, active.key) : s.board,
  }));
  endIntervention(c, byTool ? "tool" : "button");
}

export function endIntervention(c: RoomController, reason: "tool" | "button" | "timeout"): void {
  c.clearAckTimer();
  if (c.state.phase !== "INTERVENE") return;
  c.log("client", "intervention.end", { reason, key: c.state.intervention?.key });
  c.mouth?.setTools([]);
  c.dispatch({ type: "INTERVENE_DONE" });
  // Keep the record before clearing the banner; the certificate lists every intervention.
  c.set((s) => ({
    intervention: undefined,
    interventionsLog: s.intervention
      ? [
          ...s.interventionsLog.filter((x) => x.key !== s.intervention?.key),
          {
            key: s.intervention.key,
            spokenText: s.intervention.spokenText,
            latencyMs: s.intervention.totalMs ?? s.intervention.latencyMs,
            acknowledged: s.intervention.acknowledged,
          },
        ]
      : s.interventionsLog,
  }));
}

/** Record how long the room waited between the violating turn and Saakshi's first sound. */
export function recordInterventionLatency(c: RoomController, at: number): void {
  const pending = c.pendingIntervention;
  if (!pending) return;
  const latencyMs = Math.round(at - pending.detectedAt);
  // What the room actually experiences: the recogniser lag before we saw the turn, plus our reaction.
  const totalMs =
    pending.sttLagMs !== undefined ? Math.round(pending.sttLagMs + latencyMs) : undefined;
  c.pendingIntervention = null;
  c.log("client", "intervention.latency", {
    key: pending.key,
    ms: latencyMs,
    stt_lag_ms: pending.sttLagMs,
    total_ms: totalMs,
  });
  // Expose the samples and the last breakdown for the latency measurement spec.
  if (typeof window !== "undefined") {
    const w = window as unknown as {
      __saakshi_latencies?: number[];
      __saakshi_last_latency?: { totalMs?: number; sttLagMs?: number; replyMs: number };
    };
    w.__saakshi_latencies = [...(w.__saakshi_latencies ?? []), totalMs ?? latencyMs];
    w.__saakshi_last_latency = { totalMs, sttLagMs: pending.sttLagMs, replyMs: latencyMs };
  }
  c.set((s) => ({
    board: s.board ? setViolationLatency(s.board, pending.key, totalMs ?? latencyMs) : s.board,
    interventionLatenciesMs: [...s.interventionLatenciesMs, latencyMs],
    interventionTotalMs:
      totalMs !== undefined ? [...s.interventionTotalMs, totalMs] : s.interventionTotalMs,
    intervention:
      s.intervention?.key === pending.key
        ? { ...s.intervention, latencyMs, totalMs }
        : s.intervention,
  }));
}

/**
 * End of pitch (P0-6): force the current turn to finalize, read any missing disclosures once, and
 * mark the board so later disclosures count as met after the nudge.
 */
export function startNudge(
  c: RoomController,
  trigger: "spoken" | "button",
  turnOrder: number,
): void {
  if (!c.dispatch({ type: "VERIFY" })) return;
  c.ears?.forceEndpoint();
  const pack = c.pack ?? getPack(c.state.setup.packId);
  const board = c.state.board;
  const line = board ? composeNudge(pack, board) : null;
  const missing = board?.checkpoints.filter((x) => x.status === "pending").map((x) => x.id) ?? [];
  c.log("client", "nudge", { trigger, turnOrder, missing, line });
  c.set((s) => ({
    board: s.board ? markNudged(s.board, turnOrder) : s.board,
    nudge: { spokenText: line ?? ALL_COVERED_LINE, missing, at: turnOrder },
  }));
  c.speakExact(line ?? ALL_COVERED_LINE);
  // Phase 3 dispatches NUDGE_DONE when teach-back begins.
}
