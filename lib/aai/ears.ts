import { openSocket, type Socket, type SocketStatus, type WebSocketCtor } from "./socket";
import { buildSttUrl, type SttUrlParams } from "./stt-url";
import {
  parseSttMessage,
  type Heartbeat,
  type SpeakerRevision,
  type SttClientMessage,
  type Termination,
  type Turn,
} from "./types";

// Ears: the Streaming STT client (trd.md section 4). Raw binary PCM16 frames in, typed events out.
// On an unexpected close it mints a fresh token and reconnects with the same parameters; turn
// orders from the new session continue after the last one seen and a `gap` event marks the hole
// (the certificate records it in Phase 3).

export type EarsConfig = Omit<SttUrlParams, "token">;

export type EarsEvent =
  | { type: "status"; status: SocketStatus }
  | { type: "begin"; sessionId: string; expiresAt: number; reconnect: boolean }
  | { type: "turn"; turn: Turn }
  | { type: "speaker_revision"; revision: SpeakerRevision }
  | { type: "heartbeat"; heartbeat: Heartbeat }
  | { type: "speech_started"; timestamp: number }
  | { type: "termination"; termination: Termination }
  | { type: "gap"; fromMs: number; toMs: number; code: number }
  | { type: "closed"; code: number; reason: string; intentional: boolean }
  | { type: "reconnect_failed"; error: string }
  | { type: "unparsed"; raw: string; error: string }
  | { type: "unknown"; eventType: string; payload: Record<string, unknown> };

export type EarsOptions = {
  mintToken: () => Promise<string>;
  config: EarsConfig;
  onEvent: (event: EarsEvent) => void;
  WebSocketCtor?: WebSocketCtor;
  now?: () => number;
  /** Reconnect after an unexpected close. Default true. */
  reconnect?: boolean;
  /** Reconnect attempts per Ears instance. Default 5. */
  maxReconnects?: number;
};

export class Ears {
  private socket: Socket | null = null;
  private currentSessionId: string | undefined;
  private turnOffset = 0;
  private maxTurnOrder = -1;
  private attempts = 0;
  private terminating = false;
  private closing = false;
  private pendingReconnect: { fromMs: number; code: number } | null = null;
  private waiters: { terminated?: () => void } = {};
  private readonly now: () => number;

  constructor(private readonly opts: EarsOptions) {
    this.now = opts.now ?? (() => performance.now());
  }

  get status(): SocketStatus {
    return this.socket?.status() ?? "closed";
  }

  get sessionId(): string | undefined {
    return this.currentSessionId;
  }

  /** Mint a token and open the socket. Resolves when the socket is open (Begin follows). */
  async connect(): Promise<void> {
    const token = await this.opts.mintToken();
    await this.open(token);
  }

  /** One 50 ms PCM16 frame as a raw binary message. Dropped while not open. */
  sendAudio(pcm: Int16Array): boolean {
    return this.socket?.send(pcm.buffer as ArrayBuffer) ?? false;
  }

  updateConfiguration(
    cfg: Omit<Extract<SttClientMessage, { type: "UpdateConfiguration" }>, "type">,
  ): boolean {
    return this.sendJson({ type: "UpdateConfiguration", ...cfg });
  }

  forceEndpoint(): boolean {
    return this.sendJson({ type: "ForceEndpoint" });
  }

  keepAlive(): boolean {
    return this.sendJson({ type: "KeepAlive" });
  }

  /** Send Terminate and wait for Termination (SpeakerRevision precedes it) or the close. */
  async terminate(timeoutMs = 6000): Promise<void> {
    this.terminating = true;
    if (!this.sendJson({ type: "Terminate" })) {
      this.socket?.close();
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.waiters.terminated = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    this.waiters.terminated = undefined;
    this.socket?.close();
  }

  /** Close without Terminate (no reconnect). */
  close(): void {
    this.closing = true;
    this.socket?.close();
  }

  // ---------------------------------------------------------------- internals

  private sendJson(msg: SttClientMessage): boolean {
    return this.socket?.send(JSON.stringify(msg)) ?? false;
  }

  private open(token: string): Promise<void> {
    const url = buildSttUrl({ token, ...this.opts.config });
    return new Promise<void>((resolve) => {
      this.socket = openSocket(
        url,
        {
          onOpen: () => {
            this.emit({ type: "status", status: "open" });
            resolve();
          },
          onText: (raw) => this.onText(raw),
          onClose: (code, reason) => this.onClose(code, reason),
          onError: () => undefined,
        },
        this.opts.WebSocketCtor,
        { binary: true },
      );
      this.emit({ type: "status", status: "connecting" });
    });
  }

  private onText(raw: string): void {
    const msg = parseSttMessage(raw);
    switch (msg.type) {
      case "unparsed":
        return this.emit({ type: "unparsed", raw: msg.raw.slice(0, 2000), error: msg.error });
      case "unknown":
        return this.emit({ type: "unknown", eventType: msg.event_type, payload: msg.payload });
      case "Begin": {
        this.currentSessionId = msg.id;
        const reconnect = this.pendingReconnect !== null;
        if (this.pendingReconnect) {
          this.emit({
            type: "gap",
            fromMs: this.pendingReconnect.fromMs,
            toMs: this.now(),
            code: this.pendingReconnect.code,
          });
          this.pendingReconnect = null;
        }
        return this.emit({
          type: "begin",
          sessionId: msg.id,
          expiresAt: msg.expires_at,
          reconnect,
        });
      }
      case "Turn": {
        const turn: Turn = { ...msg, turn_order: msg.turn_order + this.turnOffset };
        this.maxTurnOrder = Math.max(this.maxTurnOrder, turn.turn_order);
        return this.emit({ type: "turn", turn });
      }
      case "SpeakerRevision": {
        const revision: SpeakerRevision = {
          ...msg,
          revisions: msg.revisions.map((r) => ({
            ...r,
            turn_order: r.turn_order + this.turnOffset,
          })),
        };
        return this.emit({ type: "speaker_revision", revision });
      }
      case "Heartbeat":
        return this.emit({ type: "heartbeat", heartbeat: msg });
      case "SpeechStarted":
        return this.emit({ type: "speech_started", timestamp: msg.timestamp });
      case "Termination":
        this.emit({ type: "termination", termination: msg });
        this.waiters.terminated?.();
        return;
    }
  }

  private onClose(code: number, reason: string): void {
    const intentional = this.terminating || this.closing;
    this.emit({ type: "status", status: "closed" });
    this.emit({ type: "closed", code, reason, intentional });
    this.waiters.terminated?.();
    if (intentional) return;
    const allowed = this.opts.reconnect ?? true;
    if (!allowed || this.attempts >= (this.opts.maxReconnects ?? 5)) return;
    this.attempts += 1;
    this.pendingReconnect = { fromMs: this.now(), code };
    this.turnOffset = this.maxTurnOrder + 1;
    void this.reconnect();
  }

  private async reconnect(): Promise<void> {
    try {
      const token = await this.opts.mintToken();
      await this.open(token);
    } catch (err) {
      this.pendingReconnect = null;
      this.emit({
        type: "reconnect_failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private emit(event: EarsEvent): void {
    this.opts.onEvent(event);
  }
}
