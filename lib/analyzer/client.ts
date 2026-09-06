import type { AnalyzeRequest, AnalyzeResponse } from "./schema";

// Browser side of layer 2. The LLM Gateway is rate limited per account and per model (this
// account: 2 requests per 60 s, see docs/decisions.md), so the client spends a small budget
// deliberately rather than calling on every advisor turn:
//
// - requests are debounced, so a burst of turns costs one call;
// - a token bucket caps calls per minute and drops the rest silently;
// - a 429 parks the client until the server's retry_after has passed;
// - results that a later completed request superseded are ignored.
//
// The deterministic rule layer is unaffected and remains the trigger for critical claims.

export type AnalyzerClientOptions = {
  fetchImpl?: typeof fetch;
  debounceMs?: number;
  /** Calls allowed per rolling minute. Default 2, matching the observed account limit. */
  callsPerMinute?: number;
  now?: () => number;
  onResult: (result: AnalyzeResponse, request: AnalyzeRequest) => void;
  onError?: (error: string, request: AnalyzeRequest) => void;
  onSkipped?: (reason: "budget" | "cooldown", request: AnalyzeRequest) => void;
};

export type AnalyzerClient = {
  schedule(request: AnalyzeRequest): void;
  dispose(): void;
  inflight(): number;
  budget(): { remaining: number; cooldownUntil: number | null };
};

export function createAnalyzerClient(opts: AnalyzerClientOptions): AnalyzerClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const debounceMs = opts.debounceMs ?? 300;
  const perMinute = opts.callsPerMinute ?? 2;
  const now = opts.now ?? (() => Date.now());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: AnalyzeRequest | null = null;
  let seq = 0;
  let lastApplied = 0;
  let inflight = 0;
  let disposed = false;
  let cooldownUntil: number | null = null;
  const spent: number[] = [];

  function remaining(): number {
    const cutoff = now() - 60_000;
    while (spent.length > 0 && spent[0]! <= cutoff) spent.shift();
    return Math.max(0, perMinute - spent.length);
  }

  async function send(request: AnalyzeRequest): Promise<void> {
    const mySeq = ++seq;
    spent.push(now());
    inflight += 1;
    try {
      const res = await fetchImpl("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
        cooldownUntil = now() + (body.retry_after ?? 60) * 1000;
        opts.onError?.("analyzer rate limited", request);
        return;
      }
      if (!res.ok) {
        opts.onError?.(`analyze responded ${res.status}`, request);
        return;
      }
      const body = (await res.json()) as AnalyzeResponse;
      if (disposed || mySeq < lastApplied) return;
      lastApplied = mySeq;
      opts.onResult(body, request);
    } catch (err) {
      opts.onError?.(err instanceof Error ? err.message : String(err), request);
    } finally {
      inflight -= 1;
    }
  }

  return {
    schedule(request) {
      if (disposed) return;
      pending = request;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const r = pending;
        pending = null;
        if (!r) return;
        if (cooldownUntil !== null && now() < cooldownUntil) return opts.onSkipped?.("cooldown", r);
        cooldownUntil = null;
        if (remaining() <= 0) return opts.onSkipped?.("budget", r);
        void send(r);
      }, debounceMs);
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    inflight: () => inflight,
    budget: () => ({ remaining: remaining(), cooldownUntil }),
  };
}
