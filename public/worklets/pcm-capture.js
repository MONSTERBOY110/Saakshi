// AudioWorkletProcessor that turns the mic input into 24 kHz mono Int16 frames of 1200 samples
// (50 ms). When the AudioContext runs at another rate (Firefox keeps its echo canceller only at
// the default rate; Safari ignores the requested rate) each frame is resampled linearly from the
// matching number of input samples, so the host always receives exactly 1200 samples per frame.
const TARGET_RATE = 24000;
const FRAME_SAMPLES = 1200;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inPerFrame = Math.round((FRAME_SAMPLES * sampleRate) / TARGET_RATE);
    this.buffer = new Float32Array(this.inPerFrame * 4);
    this.length = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    this.append(channel);
    while (this.length >= this.inPerFrame) {
      const chunk = this.buffer.subarray(0, this.inPerFrame);
      const samples = sampleRate === TARGET_RATE ? chunk : resample(chunk, FRAME_SAMPLES);
      const pcm = new Int16Array(FRAME_SAMPLES);
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        const s = Math.max(-1, Math.min(1, samples[i] || 0));
        pcm[i] = Math.trunc(s < 0 ? s * 32768 : s * 32767);
      }
      this.port.postMessage({ type: "frame", pcm: pcm.buffer }, [pcm.buffer]);
      this.buffer.copyWithin(0, this.inPerFrame, this.length);
      this.length -= this.inPerFrame;
    }
    return true;
  }

  append(channel) {
    if (this.length + channel.length > this.buffer.length) {
      const grown = new Float32Array((this.length + channel.length) * 2);
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
    }
    this.buffer.set(channel, this.length);
    this.length += channel.length;
  }
}

function resample(input, outLen) {
  const out = new Float32Array(outLen);
  const last = input.length - 1;
  const step = input.length / outLen;
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const idx = Math.min(Math.floor(pos), last);
    const next = Math.min(idx + 1, last);
    const frac = pos - idx;
    out[i] = input[idx] + (input[next] - input[idx]) * frac;
  }
  return out;
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
