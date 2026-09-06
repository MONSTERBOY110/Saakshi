import type { AudioGates } from "@/lib/session/machine";

// Audio router (trd.md section 3.2): every frame goes to the Ears when the phase allows, and to the
// Mouth only when the phase gate is open. The Mouth never receives audio faster than real time:
// frames that would run more than `maxLeadMs` ahead of the wall clock are dropped.

export type RouterSinks = {
  ears: (pcm: Int16Array) => boolean;
  mouth: (pcm: Int16Array) => boolean;
};

export type RouterOptions = {
  gates: () => AudioGates;
  sinks: RouterSinks;
  now?: () => number;
  /** Duration of one frame in ms. Default 50. */
  frameMs?: number;
  /** Maximum audio lead over wall time for the Mouth. Default 1000. */
  maxLeadMs?: number;
};

export type RouterStats = { frames: number; earsSent: number; mouthSent: number; dropped: number };

export type Router = {
  push(pcm: Int16Array): { ears: boolean; mouth: boolean; dropped: boolean };
  stats(): RouterStats;
};

export function createRouter(opts: RouterOptions): Router {
  const now = opts.now ?? (() => performance.now());
  const frameMs = opts.frameMs ?? 50;
  const maxLead = opts.maxLeadMs ?? 1000;
  const stats: RouterStats = { frames: 0, earsSent: 0, mouthSent: 0, dropped: 0 };
  let mouthStart: number | null = null;
  let mouthSentMs = 0;

  return {
    push(pcm) {
      stats.frames += 1;
      const gates = opts.gates();
      let ears = false;
      let mouth = false;
      let dropped = false;
      if (gates.micToEars) {
        ears = opts.sinks.ears(pcm);
        if (ears) stats.earsSent += 1;
      }
      if (gates.micToMouth) {
        const t = now();
        if (mouthStart === null) {
          mouthStart = t;
          mouthSentMs = 0;
        }
        const lead = mouthSentMs - (t - mouthStart);
        if (lead > maxLead) {
          dropped = true;
          stats.dropped += 1;
        } else {
          mouth = opts.sinks.mouth(pcm);
          if (mouth) {
            stats.mouthSent += 1;
            mouthSentMs += frameMs;
          }
        }
      } else {
        mouthStart = null;
      }
      return { ears, mouth, dropped };
    },
    stats: () => ({ ...stats }),
  };
}
