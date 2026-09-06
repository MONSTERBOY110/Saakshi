import type { MouthEvent } from "@/lib/aai/mouth";
import type { RoomController } from "./controller";
import { acknowledgeIntervention, endIntervention, recordInterventionLatency } from "./flows";
import { ACK_WINDOW_MS } from "./intervention";
import { onMouthClosed } from "./mouth-resume";
import {
  finishTeachback,
  markReexplained,
  recordAnswer,
  relaxTurnDetection,
  restoreTurnDetection,
} from "./teachback";
import type { TeachbackVerdict } from "./store";

// Voice Agent events into room state. Wire-level type names are kept in the debug log so the
// drawer and the live specs read the same names as the AssemblyAI docs.

const MOUTH_WIRE: Partial<Record<MouthEvent["type"], string>> = {
  ready: "session.ready",
  updated: "session.updated",
  error: "session.error",
  ended: "session.ended",
  speech_started: "input.speech.started",
  speech_stopped: "input.speech.stopped",
  user_delta: "transcript.user.delta",
  user_final: "transcript.user",
  reply_started: "reply.started",
  reply_audio: "reply.audio",
  agent_delta: "transcript.agent.delta",
  agent_final: "transcript.agent",
  reply_done: "reply.done",
  tool_call: "tool.call",
};

export function handleMouthEvent(c: RoomController, e: MouthEvent): void {
  if (e.type === "unparsed") return c.log("agent", "unparsed", e);
  if (e.type === "unknown") return c.log("agent", e.eventType, e.payload);
  // reply.audio arrives as 10 ms chunks; only the first chunk of each reply is logged.
  if (e.type !== "reply_audio" || e.firstChunk) {
    const client = e.type === "status" || e.type === "closed" || e.type === "latency";
    c.log(client ? "client" : "agent", MOUTH_WIRE[e.type] ?? `mouth.${e.type}`, e);
  }
  switch (e.type) {
    case "status":
      return c.set((s) => ({
        status: {
          ...s.status,
          mouth: e.status,
          mouthReady: e.status === "open" && s.status.mouthReady,
        },
      }));
    case "ready":
      return c.set((s) => ({
        status: { ...s.status, mouthReady: true, mouthSessionId: e.sessionId },
      }));
    case "error":
      return c.set((s) => ({ status: { ...s.status, mouthError: `${e.code}: ${e.message}` } }));
    case "speech_started":
      c.toolResults.noteTurnStarted("input.speech.started");
      c.playback?.flush();
      return;
    case "reply_started":
      c.toolResults.noteTurnStarted("reply.started");
      return c.set((s) => ({ status: { ...s.status, agentSpeaking: true } }));
    case "reply_audio":
      if (e.firstChunk) recordInterventionLatency(c, performance.now());
      c.playback?.play(e.data);
      return;
    case "latency":
      return c.set((s) => ({ latenciesMs: [...s.latenciesMs, e.ms] }));
    case "agent_delta":
      return c.set((s) => ({ captions: { ...s.captions, live: s.captions.live + e.delta } }));
    case "agent_final":
      c.set((s) => ({
        captions: { live: "", history: [...s.captions.history.slice(-9), e.text] },
      }));
      // Tell the STT what the agent just said so it has conversational context (trd.md section 4).
      c.ears?.updateConfiguration({ agent_context: e.text.slice(0, 1750) });
      return;
    case "user_final":
      // The customer has started answering, so endpointing goes back to conversational timing.
      if (c.state.phase === "TEACHBACK") restoreTurnDetection(c);
      return;
    case "reply_done":
      onReplyDone(c, e.status === "interrupted");
      return;
    case "tool_call":
      return onToolCall(c, e);
    case "ended":
      return c.set((s) => ({ status: { ...s.status, mouthReady: false, agentSpeaking: false } }));
    case "closed":
      c.set((s) => ({ status: { ...s.status, mouthReady: false, agentSpeaking: false } }));
      // A drop the room did not ask for is recoverable inside the 30 s resume window.
      onMouthClosed(c, e);
      return;
    default:
      return;
  }
}

function onReplyDone(c: RoomController, interrupted: boolean): void {
  if (interrupted) c.playback?.flush();
  c.set((s) => ({ status: { ...s.status, agentSpeaking: false } }));
  c.toolResults.noteReplyDone(c, interrupted);
  const phase = c.state.phase;
  // Judge-solo: the synthetic advisor waits for Saakshi's greeting to finish before he starts, so
  // the two voices do not talk over each other on the judge's very first impression.
  if (phase === "CALIBRATE" && c.judgeSolo?.state().status === "idle") c.judgeSolo.start();
  // The acknowledgement window opens once the correction has been spoken.
  if (phase === "INTERVENE" && !c.state.intervention?.acknowledged) return armAckWindow(c);
  // The nudge line has finished, so the room moves on to the teach-back.
  if (phase === "NUDGE" && !interrupted) return void c.teachback();
  // Saakshi has just asked something, so the customer gets longer to think before endpointing.
  if (phase === "TEACHBACK" && !interrupted) return relaxTurnDetection(c);
  // The certificate is stored and the closing line has been spoken, so the room shuts itself down.
  // Waiting for this reply rather than for CERTIFIED is what stops the last sentence being cut off,
  // and closing the sockets is what stops a finished session billing in the background.
  if (phase === "DONE" && c.state.certificate?.status === "stored") void c.stop();
}

function armAckWindow(c: RoomController): void {
  c.clearAckTimer();
  c.ackTimer = setTimeout(() => endIntervention(c, "timeout"), ACK_WINDOW_MS);
}

const VERDICTS: TeachbackVerdict[] = ["understood", "partial", "not_understood"];

function onToolCall(c: RoomController, e: Extract<MouthEvent, { type: "tool_call" }>): void {
  const str = (key: string): string => (typeof e.args[key] === "string" ? e.args[key] : "");
  switch (e.name) {
    case "ack_intervention": {
      const acknowledged = e.args.acknowledged !== false;
      c.toolResults.queue(c, { callId: e.callId, result: { ok: true, recorded: acknowledged } });
      if (acknowledged) acknowledgeIntervention(c, str("note"), true);
      return;
    }
    case "record_answer": {
      const raw = str("verdict") as TeachbackVerdict;
      const verdict = VERDICTS.includes(raw) ? raw : "partial";
      const out = recordAnswer(c, {
        questionId: str("question_id"),
        verdict,
        customerWords: str("customer_words"),
      });
      // A specific error tells the agent what to do next instead of guessing (docs, tools page).
      c.toolResults.queue(c, {
        callId: e.callId,
        result: out.recorded ? { ok: true, recorded: verdict } : { error: out.reason },
        isError: !out.recorded,
      });
      return;
    }
    case "reexplain": {
      const out = markReexplained(c, str("question_id"), str("reason"));
      c.toolResults.queue(c, {
        callId: e.callId,
        result: out.allowed ? { ok: true, note: out.note } : { error: out.note },
        isError: !out.allowed,
      });
      return;
    }
    case "finish_teachback":
      // Hold mode: the agent is silent from here. The result goes back once the certificate is
      // written, and that result is what fires the closing line.
      finishTeachback(c, str("summary"), e.callId);
      return;
    default:
      c.toolResults.queue(c, {
        callId: e.callId,
        result: { error: `There is no tool called ${e.name}. Use only the tools you were given.` },
        isError: true,
      });
  }
}
