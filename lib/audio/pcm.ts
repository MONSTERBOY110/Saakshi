// Pure PCM helpers shared by the worklet host, the router and the playback path. No DOM access.

/** Scale float samples in [-1, 1] to int16, clamping anything outside the range. */
export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = Math.trunc(s < 0 ? s * 32768 : s * 32767);
  }
  return out;
}

/** Little-endian int16 bytes as base64 (the Voice Agent input.audio payload). */
export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] ?? 0;
    bytes[i * 2] = v & 0xff;
    bytes[i * 2 + 1] = (v >> 8) & 0xff;
  }
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

/** Inverse of int16ToBase64 (the Voice Agent reply.audio payload). */
export function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const out = new Int16Array(Math.floor(binary.length / 2));
  for (let i = 0; i < out.length; i++) {
    const lo = binary.charCodeAt(i * 2);
    const hi = binary.charCodeAt(i * 2 + 1);
    out[i] = (((hi << 8) | lo) << 16) >> 16;
  }
  return out;
}

/** Linear-interpolation resampler. Good enough for speech on the non-Chromium fallback path. */
export function resampleLinear(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const outLen = Math.round((input.length * to) / from);
  const out = new Float32Array(outLen);
  const last = input.length - 1;
  for (let i = 0; i < outLen; i++) {
    const pos = (i * from) / to;
    const idx = Math.min(Math.floor(pos), last);
    const next = Math.min(idx + 1, last);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[next] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}
