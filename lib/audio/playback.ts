import { base64ToInt16 } from "./pcm";

// Ported from the reference playReplyAudio / flushPlayback in docs/assemblyai-voice-agent-gotchas.md.
// Buffers are built at 24 kHz; Web Audio resamples them if the context runs at another rate, so
// playback shares the capture context and the echo canceller sees the agent output it must cancel.
export const PLAYBACK_RATE = 24000;

export type Playback = {
  play(b64: string): void;
  /** Stop everything queued. Call on input.speech.started and on reply.done status interrupted. */
  flush(): void;
  queuedSeconds(): number;
};

export function createPlayback(ctx: AudioContext): Playback {
  let nextStartTime = 0;
  const liveSources = new Set<AudioBufferSourceNode>();

  function play(b64: string): void {
    const pcm = base64ToInt16(b64);
    if (pcm.length === 0) return;
    const buffer = ctx.createBuffer(1, pcm.length, PLAYBACK_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = (pcm[i] ?? 0) / 32768;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, nextStartTime);
    source.start(startAt);
    source.onended = () => liveSources.delete(source);
    liveSources.add(source);
    nextStartTime = startAt + buffer.duration;
  }

  function flush(): void {
    for (const source of liveSources) {
      try {
        source.onended = null;
        source.stop(0);
        source.disconnect();
      } catch {
        // already stopped
      }
    }
    liveSources.clear();
    nextStartTime = ctx.currentTime;
  }

  return { play, flush, queuedSeconds: () => Math.max(0, nextStartTime - ctx.currentTime) };
}
