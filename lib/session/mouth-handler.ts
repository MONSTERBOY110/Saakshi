import type { MouthEvent } from "@/lib/aai/mouth";
import type { RoomController } from "./controller";
import { acknowledgeIntervention, endIntervention, recordInterventionLatency } from "./flows";
import { ACK_WINDOW_MS } from "./intervention";

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
      c.playback?.flush();
      return;
    case "reply_started":
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
    case "reply_done":
      if (e.status === "interrupted") c.playback?.flush();
      c.set((s) => ({ status: { ...s.status, agentSpeaking: false } }));
      // The acknowledgement window opens once the correction has been spoken.
      if (c.state.phase === "INTERVENE" && !c.state.intervention?.acknowledged) armAckWindow(c);
      return;
    case "tool_call":
      return onToolCall(c, e);
    case "ended":
    case "closed":
      return c.set((s) => ({ status: { ...s.status, mouthReady: false, agentSpeaking: false } }));
    default:
      return;
  }
}

function armAckWindow(c: RoomController): void {
  c.clearAckTimer();
  c.ackTimer = setTimeout(() => endIntervention(c, "timeout"), ACK_WINDOW_MS);
}

function onToolCall(c: RoomController, e: Extract<MouthEvent, { type: "tool_call" }>): void {
  if (e.name === "ack_intervention") {
    const acknowledged = e.args.acknowledged !== false;
    const note = typeof e.args.note === "string" ? e.args.note : "";
    // The result must be a JSON string and must go back immediately (docs, gotchas file).
    c.mouth?.toolResult(e.callId, { ok: true, recorded: acknowledged });
    if (acknowledged) acknowledgeIntervention(c, note, true);
    return;
  }
  c.mouth?.toolResult(e.callId, { ok: false, error: `unknown tool ${e.name}` }, true);
}
