import { TEACHBACK_TOOLS, TEACHBACK_TOOLS_WITH_FINISH } from "@/lib/aai/tools";
import { buildTeachbackPrompt, FINISH_TEACHBACK_INSTRUCTION } from "@/lib/prompts/teachback";
import type { RoomController } from "./controller";
import type { Phase } from "./machine";

// A Voice Agent socket that drops without session.end leaves a 30 s window in which session.resume
// reattaches to the same session (trd.md section 5). Losing the Mouth mid teach-back would strand
// the customer mid-question, so the room reconnects rather than restarting, and writes the silence
// into the certificate as a gap: an unexplained hole in the record is worse than a recorded one.

/** Phases where losing the agent matters enough to reconnect. */
const LIVE_PHASES: Phase[] = ["CALIBRATE", "OBSERVE", "INTERVENE", "NUDGE", "TEACHBACK"];

/** The server holds the session for 30 s; the last attempt has to start inside that. */
const RETRY_DELAYS_MS = [0, 2000, 5000, 9000] as const;

export function onMouthClosed(
  c: RoomController,
  e: { code: number; reason: string; intentional: boolean },
): void {
  if (e.intentional) return;
  const sessionId = c.state.status.mouthSessionId;
  const phase = c.state.phase;
  if (!sessionId || !LIVE_PHASES.includes(phase)) return;
  void resumeMouth(c, sessionId, e.code);
}

async function resumeMouth(c: RoomController, sessionId: string, code: number): Promise<void> {
  const droppedAt = performance.now();
  c.log("client", "mouth.resume.start", { session_id: sessionId, code, phase: c.state.phase });

  for (const [attempt, delay] of RETRY_DELAYS_MS.entries()) {
    if (delay > 0) await sleep(delay);
    // The operator may have stopped the room, or a later phase may have taken over, while we waited.
    if (!c.mouth || !LIVE_PHASES.includes(c.state.phase)) {
      c.log("client", "mouth.resume.abandoned", { phase: c.state.phase });
      return;
    }
    try {
      await c.mouth.resume(sessionId);
      const recoveredAt = performance.now();
      recordGap(c, droppedAt, recoveredAt, code);
      c.log("client", "mouth.resumed", {
        session_id: sessionId,
        attempt: attempt + 1,
        silent_ms: Math.round(recoveredAt - droppedAt),
      });
      reapplyPhaseConfig(c);
      return;
    } catch (err) {
      c.log("client", "mouth.resume.failed", {
        attempt: attempt + 1,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Out of window. The gap is still recorded, because the room was deaf for that time either way.
  recordGap(c, droppedAt, performance.now(), code);
  c.set((s) => ({
    status: { ...s.status, mouthError: `resume failed after ${code}` },
  }));
  c.log("client", "mouth.resume.gave_up", { session_id: sessionId, code });
}

/** Gaps are stored as milliseconds since the session started, which is what the certificate wants. */
function recordGap(c: RoomController, fromClock: number, toClock: number, code: number): void {
  c.set((s) => ({
    gaps: [
      ...s.gaps,
      { fromMs: Math.max(0, Math.round(fromClock - c.t0)), toMs: Math.round(toClock - c.t0), code },
    ],
  }));
}

/**
 * A resumed session confirms with session.updated, and the room cannot see whether the prompt and
 * tools survived. Re-sending them is idempotent and costs one message, so the teach-back carries on
 * with the questions it was already asking rather than an agent that has forgotten them.
 */
function reapplyPhaseConfig(c: RoomController): void {
  const tb = c.state.teachback;
  if (c.state.phase !== "TEACHBACK" || !tb || tb.questions.length === 0) return;
  const { setup } = c.state;
  const prompt = buildTeachbackPrompt({
    advisor: setup.advisorName,
    customer: setup.customerName,
    product: setup.productName,
    questions: tb.questions,
  });
  c.mouth?.updateSession({
    system_prompt: tb.finishOffered ? prompt + FINISH_TEACHBACK_INSTRUCTION : prompt,
    tools: tb.finishOffered ? TEACHBACK_TOOLS_WITH_FINISH : TEACHBACK_TOOLS,
  });
  const next = tb.questions[tb.answers.length];
  if (next) {
    c.mouth?.replyCreate(
      `The connection dropped for a moment. Say one short line to apologise, then ask this question again, worded exactly as written: ${next.question}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
