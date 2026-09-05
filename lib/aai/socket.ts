// Minimal WebSocket wrapper shared by the Ears and Mouth clients. The constructor is injectable
// so unit tests can drive a fake socket with recorded payloads.

export type SocketStatus = "closed" | "connecting" | "open" | "closing";

export interface WebSocketLike {
  readyState: number;
  binaryType: BinaryType;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

export type SocketHandlers = {
  onOpen(): void;
  onText(raw: string): void;
  onClose(code: number, reason: string): void;
  onError(): void;
};

export type Socket = {
  /** Returns false (and drops the data) unless the socket is open. */
  send(data: string | ArrayBuffer): boolean;
  close(code?: number, reason?: string): void;
  status(): SocketStatus;
};

export function defaultWebSocketCtor(): WebSocketCtor {
  if (typeof WebSocket === "undefined") throw new Error("WebSocket is not available here");
  return WebSocket as unknown as WebSocketCtor;
}

export function openSocket(
  url: string,
  handlers: SocketHandlers,
  Ctor: WebSocketCtor = defaultWebSocketCtor(),
  opts: { binary?: boolean } = {},
): Socket {
  const ws = new Ctor(url);
  if (opts.binary) ws.binaryType = "arraybuffer";
  ws.onopen = () => handlers.onOpen();
  ws.onmessage = (ev: MessageEvent) => {
    if (typeof ev.data === "string" && ev.data.length > 0) handlers.onText(ev.data);
  };
  ws.onclose = (ev: CloseEvent) => handlers.onClose(ev.code, ev.reason);
  ws.onerror = () => handlers.onError();
  return {
    send: (data) => {
      if (ws.readyState !== 1) return false;
      ws.send(data);
      return true;
    },
    close: (code, reason) => ws.close(code, reason),
    status: () => statusOf(ws.readyState),
  };
}

export function statusOf(readyState: number): SocketStatus {
  switch (readyState) {
    case 0:
      return "connecting";
    case 1:
      return "open";
    case 2:
      return "closing";
    default:
      return "closed";
  }
}
