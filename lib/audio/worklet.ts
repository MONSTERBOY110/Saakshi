// Contract between the AudioWorklet processor (public/worklets/pcm-capture.js) and its host.
export const WORKLET_URL = "/worklets/pcm-capture.js";
export const WORKLET_NAME = "pcm-capture";
export const TARGET_RATE = 24000;
/** 50 ms at 24 kHz. Both AssemblyAI sockets accept 50 ms frames (STT allows 50 to 1000 ms). */
export const FRAME_SAMPLES = 1200;

export type FrameMessage = { type: "frame"; pcm: ArrayBuffer };
