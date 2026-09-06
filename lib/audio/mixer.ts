// Judge-solo mixing (prd.md FR-11, trd.md section 8). A pre-rendered advisor is added to the
// judge's microphone frame before it reaches Streaming STT, so diarization hears two speakers and
// the judge only has to play the customer. The same synthetic frame goes to the speakers so the
// room hears the advisor, and never to the Voice Agent, which must not answer its own script.

const MIN = -32768;
const MAX = 32767;

/**
 * The two voices added together in a new frame, clipped rather than wrapped. Wrapping an overflow
 * turns a loud moment into a click, which the recogniser hears as a consonant.
 */
export function mixInt16(target: Int16Array, source: Int16Array, gain = 1): Int16Array {
  const out = new Int16Array(target);
  const overlap = Math.min(target.length, source.length);
  for (let i = 0; i < overlap; i++) {
    const sum = (target[i] as number) + Math.round((source[i] as number) * gain);
    out[i] = sum > MAX ? MAX : sum < MIN ? MIN : sum;
  }
  return out;
}

export type FrameReader = {
  /** The next frame, zero-padded at the end of the audio, or null when there is none. */
  next(): Int16Array | null;
  done(): boolean;
  progress(): { sample: number; total: number };
};

/** A cursor over a PCM buffer that hands out fixed-size frames, so playback can be paced. */
export function createFrameReader(pcm: Int16Array, frameSamples: number): FrameReader {
  let sample = 0;
  return {
    next() {
      if (sample >= pcm.length) return null;
      const frame = new Int16Array(frameSamples);
      frame.set(pcm.subarray(sample, Math.min(sample + frameSamples, pcm.length)));
      sample += frameSamples;
      return frame;
    },
    done: () => sample >= pcm.length,
    progress: () => ({ sample: Math.min(sample, pcm.length), total: pcm.length }),
  };
}
