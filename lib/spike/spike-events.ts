import type { AgentEvent, SttEvent } from "@/lib/aai/types";
import type { SpikeHost } from "./spike-state";

// Socket event handlers for the spike page. Pure with respect to the DOM; side effects go through
// the host (state patches, log entries, playback, waiters).

export function handleEars(host: SpikeHost, msg: SttEvent): void {
  if (msg.type === "unparsed") {
    host.log("stt", "unparsed", { raw: msg.raw.slice(0, 2000), error: msg.error });
    return;
  }
  if (msg.type === "unknown") {
    host.log("stt", msg.event_type, msg.payload);
    return;
  }
  host.log("stt", msg.type, msg);
  switch (msg.type) {
    case "Begin":
      host.set((s) => ({ ears: { ...s.ears, sessionId: msg.id } }));
      break;
    case "Heartbeat":
      host.set((s) => ({
        ears: {
          ...s.ears,
          heartbeat: {
            audioMs: msg.total_audio_received_ms,
            realtimeFactor: msg.realtime_factor,
            wallMs: Math.round(performance.now() - host.t0),
          },
        },
      }));
      break;
    case "Termination":
      host.waiters.terminated?.();
      break;
  }
}

export function handleMouth(host: SpikeHost, ev: AgentEvent): void {
  if (ev.type === "unparsed") {
    host.log("agent", "unparsed", { raw: ev.raw.slice(0, 2000), error: ev.error });
    return;
  }
  if (ev.type === "unknown") {
    host.log("agent", ev.event_type, ev.payload);
    return;
  }
  // reply.audio arrives as 10 ms chunks (about 100 per second); log the first chunk of each
  // reply and a summary at reply.done so the drawer is not flooded.
  if (ev.type === "reply.audio") {
    if (host.replyAudio.chunks === 0) host.log("agent", ev.type, ev);
    host.replyAudio.chunks += 1;
    host.replyAudio.b64Chars += ev.data.length;
  } else {
    host.log("agent", ev.type, ev);
  }
  if (ev.type === "reply.done" && host.replyAudio.chunks > 0) {
    host.log("client", "reply.audio.summary", {
      reply_id: ev.reply_id,
      chunks: host.replyAudio.chunks,
      pcm_bytes: Math.round((host.replyAudio.b64Chars * 3) / 4),
    });
    host.replyAudio = { chunks: 0, b64Chars: 0 };
  }

  switch (ev.type) {
    case "session.ready":
      host.set((s) => ({ mouth: { ...s.mouth, sessionId: ev.session_id, ready: true } }));
      break;
    case "session.error":
      host.set((s) => ({ mouth: { ...s.mouth, lastError: `${ev.code}: ${ev.message}` } }));
      break;
    case "session.ended":
      host.waiters.ended?.();
      break;
    case "input.speech.started":
      host.playback?.flush();
      break;
    case "reply.audio":
      if (host.pendingReplyAt !== null) {
        const latency = Math.round(performance.now() - host.pendingReplyAt);
        host.pendingReplyAt = null;
        host.set((s) => ({ latenciesMs: [...s.latenciesMs, latency] }));
        host.log("client", "latency.reply_create_to_first_audio", { ms: latency });
      }
      host.playback?.play(ev.data);
      break;
    case "reply.done":
      if (ev.status === "interrupted") host.playback?.flush();
      break;
    case "transcript.agent.delta":
      host.set((s) => ({ captions: { ...s.captions, live: s.captions.live + ev.delta } }));
      break;
    case "transcript.agent":
      host.set((s) => ({
        captions: { live: "", history: [...s.captions.history.slice(-9), ev.text] },
      }));
      host.waiters.agentText?.(ev.text);
      break;
    case "transcript.user.delta":
    case "transcript.user":
      // transcript.user.delta carries the cumulative partial, so replace rather than append.
      host.set({ userTranscript: ev.text });
      break;
  }
}
