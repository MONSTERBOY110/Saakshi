// Event log shared by the spike page and the fixture exporter. Audio never enters the log:
// reply.audio payloads are reduced to their length and a short head before storage.
export type LogSource = "stt" | "agent" | "client";

export type LogEvent = {
  id: number;
  /** performance.now() based, ms since session start. */
  t: number;
  source: LogSource;
  type: string;
  payload: unknown;
};

export const LOG_LIMIT = 5000;
export const AUDIO_HEAD_CHARS = 32;

/** Replace base64 audio with { data_len, data_head } so no audio is ever kept or exported. */
export function stripAudio(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const p = payload as Record<string, unknown>;
  if (p.type === "reply.audio" && typeof p.data === "string") {
    const { data, ...rest } = p;
    return { ...rest, data_len: data.length, data_head: data.slice(0, AUDIO_HEAD_CHARS) };
  }
  if (p.type === "input.audio" && typeof p.audio === "string") {
    const { audio, ...rest } = p;
    return { ...rest, audio_len: audio.length };
  }
  return payload;
}

export function appendEvent(events: LogEvent[], event: LogEvent): LogEvent[] {
  const next =
    events.length >= LOG_LIMIT ? events.slice(events.length - LOG_LIMIT + 1) : events.slice();
  next.push(event);
  return next;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const m = Math.floor(total / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const frac = total % 1000;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(frac).padStart(3, "0")}`;
}

export function fixtureExport(events: LogEvent[]) {
  return {
    captured_at: new Date().toISOString(),
    app: "saakshi",
    note: "Recorded from live AssemblyAI sessions. Audio payloads are stripped to length and head.",
    events: events.map((e) => ({ ...e, payload: stripAudio(e.payload) })),
  };
}
