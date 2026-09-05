// In-memory WebSocket for unit tests. Tests drive the server side with serverOpen(),
// serverMessage() and serverClose().
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static reset(): void {
    FakeWebSocket.instances = [];
  }

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = 0;
  binaryType: BinaryType = "blob";
  readonly url: string;
  readonly sent: Array<string | ArrayBuffer> = [];
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string | ArrayBuffer): void {
    if (this.readyState !== 1) throw new Error("FakeWebSocket: send while not open");
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean: true } as CloseEvent);
  }

  // ---- server side ----
  serverOpen(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  serverMessage(json: unknown): void {
    this.onmessage?.({ data: JSON.stringify(json) } as MessageEvent);
  }

  serverRaw(text: string): void {
    this.onmessage?.({ data: text } as MessageEvent);
  }

  serverClose(code: number, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean: false } as CloseEvent);
  }

  sentJson(): Array<Record<string, unknown>> {
    return this.sent
      .filter((s): s is string => typeof s === "string")
      .map((s) => JSON.parse(s) as Record<string, unknown>);
  }

  sentBinary(): ArrayBuffer[] {
    return this.sent.filter((s): s is ArrayBuffer => typeof s !== "string");
  }

  static latest(): FakeWebSocket {
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (!ws) throw new Error("no FakeWebSocket instance");
    return ws;
  }
}
