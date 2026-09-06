import { int16ToBase64 } from "@/lib/audio/pcm";
import { AGENT_WS_BASE, type AgentSessionConfig, type AgentToolDefinition } from "./agent-config";
import { openSocket, type Socket, type SocketStatus, type WebSocketCtor } from "./socket";
import { parseAgentEvent, type AgentClientMessage } from "./types";

// Mouth: the Voice Agent client (trd.md section 5). Inline session configuration, scripted speech
// through reply.create, mutable prompt and tools through session.update. Audio playback is the
// caller's job (lib/audio/playback.ts); this class only reports events.

export type MouthEvent =
  | { type: "status"; status: SocketStatus }
  | { type: "ready"; sessionId: string; config: unknown }
  | { type: "updated"; config: unknown }
  | { type: "error"; code: string; message: string }
  | { type: "speech_started" }
  | { type: "speech_stopped" }
  | { type: "user_delta"; text: string }
  | { type: "user_final"; text: string }
  | { type: "reply_started"; replyId?: string }
  | { type: "reply_audio"; data: string; firstChunk: boolean }
  | { type: "agent_delta"; delta: string; startMs?: number | null; endMs?: number | null }
  | { type: "agent_final"; text: string; interrupted: boolean }
  | { type: "reply_done"; status: "completed" | "interrupted"; replyId?: string }
  | { type: "latency"; ms: number }
  | { type: "tool_call"; callId: string; name: string; args: Record<string, unknown> }
  | { type: "ended"; sessionDurationSeconds?: number | null }
  | { type: "closed"; code: number; reason: string; intentional: boolean }
  | { type: "unparsed"; raw: string; error: string }
  | { type: "unknown"; eventType: string; payload: Record<string, unknown> };

export type MouthOptions = {
  mintToken: () => Promise<string>;
  session: AgentSessionConfig | Record<string, unknown>;
  onEvent: (event: MouthEvent) => void;
  WebSocketCtor?: WebSocketCtor;
  now?: () => number;
  /** How long to wait for session.ready after the socket opens. Default 15 s. */
  readyTimeoutMs?: number;
};

export class Mouth {
  private socket: Socket | null = null;
  private isReady = false;
  private currentSessionId: string | undefined;
  private pendingReplyAt: number | null = null;
  private chunkCount = 0;
  private ending = false;
  private closing = false;
  private waiters: { ready?: (err?: Error) => void; ended?: () => void } = {};
  private readonly now: () => number;

  constructor(private readonly opts: MouthOptions) {
    this.now = opts.now ?? (() => performance.now());
  }

  get status(): SocketStatus {
    return this.socket?.status() ?? "closed";
  }

  get ready(): boolean {
    return this.isReady;
  }

  get sessionId(): string | undefined {
    return this.currentSessionId;
  }

  /** Mint a token, open the socket, send session.update, resolve on session.ready. */
  connect(): Promise<void> {
    const first: AgentClientMessage = {
      type: "session.update",
      session: this.opts.session as Record<string, unknown>,
    };
    return this.openSession(first, "session.ready not received");
  }

  /** One PCM16 frame as base64 input.audio. Dropped until session.ready. */
  sendAudio(pcm: Int16Array): boolean {
    if (!this.isReady) return false;
    return this.sendJson({ type: "input.audio", audio: int16ToBase64(pcm) });
  }

  /** Ask the agent to speak. Instructions are followed verbatim (spike S5: 10/10). */
  replyCreate(instructions: string): boolean {
    const sent = this.sendJson({ type: "reply.create", instructions });
    if (sent) this.pendingReplyAt = this.now();
    return sent;
  }

  /** Mutable fields only: system_prompt, tools, input.keyterms, input.turn_detection, output.volume. */
  updateSession(session: Record<string, unknown>): boolean {
    return this.sendJson({ type: "session.update", session });
  }

  /** Replace the tool set. session.tools updates replace the array, they do not merge. */
  setTools(tools: AgentToolDefinition[]): boolean {
    return this.updateSession({ tools });
  }

  /**
   * Reconnect to a session dropped without session.end (30 s window): fresh token, fresh socket,
   * session.resume with the saved id. Resolves on session.ready or session.updated.
   */
  resume(sessionId: string): Promise<void> {
    return this.openSession(
      { type: "session.resume", session_id: sessionId },
      "session.resume not confirmed",
    );
  }

  /**
   * Fresh token, fresh socket, one bootstrap message, then wait for the session to be usable.
   * Shared by connect and resume, which differ only in that message.
   */
  private async openSession(first: AgentClientMessage, failure: string): Promise<void> {
    const token = await this.opts.mintToken();
    const url = `${AGENT_WS_BASE}?token=${encodeURIComponent(token)}`;
    const readyTimeoutMs = this.opts.readyTimeoutMs ?? 15_000;
    this.ending = false;
    this.closing = false;
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      this.waiters.ready = (err) => {
        if (timer) clearTimeout(timer);
        this.waiters.ready = undefined;
        if (err) reject(err);
        else resolve();
      };
      this.socket = openSocket(
        url,
        {
          onOpen: () => {
            this.emit({ type: "status", status: "open" });
            this.sendJson(first);
            timer = setTimeout(() => {
              this.waiters.ready?.(new Error(`${failure} within ${readyTimeoutMs} ms`));
              this.socket?.close();
            }, readyTimeoutMs);
          },
          onText: (raw) => this.onText(raw),
          onClose: (code, reason) => this.onClose(code, reason),
          onError: () => undefined,
        },
        this.opts.WebSocketCtor,
      );
      this.emit({ type: "status", status: "connecting" });
    });
  }

  conversationMessage(role: "user" | "system", content: string): boolean {
    return this.sendJson({ type: "conversation.message", role, content });
  }

  /** `result` is serialised to a JSON string as the API requires. */
  toolResult(callId: string, result: unknown, isError?: boolean): boolean {
    const msg: AgentClientMessage = {
      type: "tool.result",
      call_id: callId,
      result: JSON.stringify(result),
    };
    if (isError !== undefined) msg.is_error = isError;
    return this.sendJson(msg);
  }

  /** session.end skips the billable 30 s resume window. Resolves on session.ended or close. */
  async end(timeoutMs = 6000): Promise<void> {
    this.ending = true;
    if (!this.sendJson({ type: "session.end" })) {
      this.socket?.close();
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.waiters.ended = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    this.waiters.ended = undefined;
    this.isReady = false;
    this.socket?.close();
  }

  /** Close without session.end (keeps the 30 s resume window open, billable). */
  close(): void {
    this.closing = true;
    this.socket?.close();
  }

  // ---------------------------------------------------------------- internals

  private sendJson(msg: AgentClientMessage): boolean {
    return this.socket?.send(JSON.stringify(msg)) ?? false;
  }

  private onText(raw: string): void {
    const ev = parseAgentEvent(raw);
    switch (ev.type) {
      case "unparsed":
        return this.emit({ type: "unparsed", raw: ev.raw.slice(0, 2000), error: ev.error });
      case "unknown":
        return this.emit({ type: "unknown", eventType: ev.event_type, payload: ev.payload });
      case "session.ready":
        this.isReady = true;
        this.currentSessionId = ev.session_id;
        this.emit({ type: "ready", sessionId: ev.session_id, config: ev.config });
        this.waiters.ready?.();
        return;
      case "session.updated":
        this.emit({ type: "updated", config: ev.config });
        // A resumed session confirms with session.updated rather than session.ready.
        if (!this.isReady && this.waiters.ready) {
          this.isReady = true;
          this.waiters.ready();
        }
        return;
      case "session.error":
        return this.emit({ type: "error", code: ev.code, message: ev.message });
      case "session.ended":
        this.isReady = false;
        this.emit({ type: "ended", sessionDurationSeconds: ev.session_duration_seconds });
        this.waiters.ended?.();
        return;
      case "input.speech.started":
        return this.emit({ type: "speech_started" });
      case "input.speech.stopped":
        return this.emit({ type: "speech_stopped" });
      case "transcript.user.delta":
        return this.emit({ type: "user_delta", text: ev.text });
      case "transcript.user":
        return this.emit({ type: "user_final", text: ev.text });
      case "reply.started":
        this.chunkCount = 0;
        return this.emit({ type: "reply_started", replyId: ev.reply_id });
      case "reply.audio": {
        const firstChunk = this.chunkCount === 0;
        this.chunkCount += 1;
        if (this.pendingReplyAt !== null) {
          this.emit({ type: "latency", ms: Math.round(this.now() - this.pendingReplyAt) });
          this.pendingReplyAt = null;
        }
        return this.emit({ type: "reply_audio", data: ev.data, firstChunk });
      }
      case "transcript.agent.delta":
        return this.emit({
          type: "agent_delta",
          delta: ev.delta,
          startMs: ev.start_ms,
          endMs: ev.end_ms,
        });
      case "transcript.agent":
        return this.emit({
          type: "agent_final",
          text: ev.text,
          interrupted: ev.interrupted ?? false,
        });
      case "reply.done":
        this.chunkCount = 0;
        return this.emit({ type: "reply_done", status: ev.status, replyId: ev.reply_id });
      case "tool.call":
        return this.emit({
          type: "tool_call",
          callId: ev.call_id,
          name: ev.name,
          args: ev.arguments,
        });
    }
  }

  private onClose(code: number, reason: string): void {
    const intentional = this.ending || this.closing;
    this.isReady = false;
    this.emit({ type: "status", status: "closed" });
    this.emit({ type: "closed", code, reason, intentional });
    this.waiters.ended?.();
    this.waiters.ready?.(new Error(`socket closed before session.ready (${code})`));
  }

  private emit(event: MouthEvent): void {
    this.opts.onEvent(event);
  }
}
