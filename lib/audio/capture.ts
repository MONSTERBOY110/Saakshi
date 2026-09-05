import { TARGET_RATE, WORKLET_NAME, WORKLET_URL, type FrameMessage } from "./worklet";

// Exact constraints from docs/assemblyai-voice-agent-gotchas.md: AEC on (stops the agent hearing
// itself), browser noise suppression off (Voice Focus runs server-side), AGC on.
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
};

export type Capture = {
  ctx: AudioContext;
  stream: MediaStream;
  /** Actual context rate. 24000 on Chromium; the worklet resamples when it differs. */
  sampleRate: number;
  stop(): Promise<void>;
};

export async function startCapture(onFrame: (pcm: Int16Array) => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  const ctx = createContext();
  if (ctx.state === "suspended") await ctx.resume();
  await ctx.audioWorklet.addModule(WORKLET_URL);

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: "explicit",
  });
  node.port.onmessage = (ev: MessageEvent<FrameMessage>) => {
    if (ev.data?.type === "frame") onFrame(new Int16Array(ev.data.pcm));
  };
  source.connect(node);

  return {
    ctx,
    stream,
    sampleRate: ctx.sampleRate,
    async stop() {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      for (const track of stream.getTracks()) track.stop();
      if (ctx.state !== "closed") await ctx.close();
    },
  };
}

// Chromium: force 24 kHz so nothing resamples. Firefox bypasses its echo canceller for
// non-default-rate contexts, so it keeps the default rate and the worklet resamples.
function createContext(): AudioContext {
  const isFirefox = typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent);
  if (!isFirefox) {
    try {
      return new AudioContext({ sampleRate: TARGET_RATE });
    } catch {
      // Safari and some devices reject the rate; fall through to the default.
    }
  }
  return new AudioContext();
}
