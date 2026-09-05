import { int16ToBase64 } from "@/lib/audio/pcm";
import {
  parseAgentEvent,
  parseSttMessage,
  type AgentClientMessage,
  type AgentEvent,
  type SttClientMessage,
  type SttEvent,
} from "@/lib/aai/types";

// Thin WebSocket wrappers for the Phase 0 spike. The typed clients in lib/aai/ears.ts and
// lib/aai/mouth.ts (Phase 1 and 2) replace these.

export type SocketStatus = "closed" | "connecting" | "open" | "closing";

type Common = {
  readonly status: () => SocketStatus;
  close(): void;
};

export type EarsSocket = Common & {
  sendAudio(frame: Int16Array): boolean;
  sendJson(msg: SttClientMessage): boolean;
};

export type MouthSocket = Common & {
  sendAudio(frame: Int16Array): boolean;
  sendJson(msg: AgentClientMessage): boolean;
};

type Handlers<TMsg> = {
  onOpen(): void;
  onMessage(msg: TMsg, raw: string): void;
  onClose(code: number, reason: string): void;
  onError(): void;
};

export function openEars(url: string, h: Handlers<SttEvent>): EarsSocket {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  wire(ws, h, parseSttMessage);
  return {
    status: () => statusOf(ws),
    close: () => ws.close(),
    // Raw binary PCM16 frames, no JSON, no base64.
    sendAudio: (frame) => sendIfOpen(ws, frame.buffer as ArrayBuffer),
    sendJson: (msg) => sendIfOpen(ws, JSON.stringify(msg)),
  };
}

export function openMouth(url: string, h: Handlers<AgentEvent>): MouthSocket {
  const ws = new WebSocket(url);
  wire(ws, h, parseAgentEvent);
  return {
    status: () => statusOf(ws),
    close: () => ws.close(),
    // Base64 PCM16 inside a JSON envelope.
    sendAudio: (frame) =>
      sendIfOpen(ws, JSON.stringify({ type: "input.audio", audio: int16ToBase64(frame) })),
    sendJson: (msg) => sendIfOpen(ws, JSON.stringify(msg)),
  };
}

function wire<TMsg>(ws: WebSocket, h: Handlers<TMsg>, parse: (raw: string) => TMsg): void {
  ws.onopen = () => h.onOpen();
  ws.onmessage = (ev: MessageEvent) => {
    const raw = typeof ev.data === "string" ? ev.data : "";
    if (!raw) return;
    h.onMessage(parse(raw), raw);
  };
  ws.onclose = (ev: CloseEvent) => h.onClose(ev.code, ev.reason);
  ws.onerror = () => h.onError();
}

function sendIfOpen(ws: WebSocket, data: string | ArrayBuffer): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  ws.send(data);
  return true;
}

function statusOf(ws: WebSocket): SocketStatus {
  switch (ws.readyState) {
    case WebSocket.CONNECTING:
      return "connecting";
    case WebSocket.OPEN:
      return "open";
    case WebSocket.CLOSING:
      return "closing";
    default:
      return "closed";
  }
}
