import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnalyzerClient } from "@/lib/analyzer/client";
import type { AnalyzeRequest } from "@/lib/analyzer/schema";

const req = (order: number): AnalyzeRequest => ({
  pack_id: "insurance-ulip-in",
  context: { advisor: "Rahul", customer: "Mrs. Sharma", product: "ULIP" },
  turns: [{ order, role: "advisor", text: `turn ${order}`, start_ms: order * 1000 }],
});

const ok = () =>
  Response.json({
    analysis: {
      checkpoints_satisfied: [],
      violations: [],
      customer_questions_unanswered: [],
      language_mix: "en",
    },
    model: "gemini-3.5-flash-lite",
    latency_ms: 700,
  });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createAnalyzerClient", () => {
  it("debounces bursts into one request carrying the latest window", async () => {
    const fetchImpl = vi.fn(async () => ok());
    const onResult = vi.fn();
    const client = createAnalyzerClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      debounceMs: 300,
      onResult,
    });
    client.schedule(req(1));
    client.schedule(req(2));
    await vi.advanceTimersByTimeAsync(299);
    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/analyze");
    expect(JSON.parse(init.body as string).turns[0].order).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[1]).toEqual(req(2));
  });

  it("reports non-2xx responses through onError and keeps working", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () =>
      ++calls === 1 ? new Response("x", { status: 502 }) : ok(),
    );
    const onResult = vi.fn();
    const onError = vi.fn();
    const client = createAnalyzerClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      debounceMs: 10,
      onResult,
      onError,
    });
    client.schedule(req(1));
    await vi.advanceTimersByTimeAsync(20);
    expect(onError).toHaveBeenCalledWith("analyze responded 502", req(1));
    client.schedule(req(2));
    await vi.advanceTimersByTimeAsync(20);
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("stops after dispose", async () => {
    const fetchImpl = vi.fn(async () => ok());
    const client = createAnalyzerClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      debounceMs: 10,
      onResult: vi.fn(),
    });
    client.schedule(req(1));
    client.dispose();
    await vi.advanceTimersByTimeAsync(50);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("analyzer budget", () => {
  it("spends at most the per-minute budget and reports skips", async () => {
    const fetchImpl = vi.fn(async () => ok());
    const onSkipped = vi.fn();
    let clock = 1_000_000;
    const client = createAnalyzerClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      debounceMs: 5,
      callsPerMinute: 2,
      now: () => clock,
      onResult: vi.fn(),
      onSkipped,
    });
    for (let i = 1; i <= 4; i++) {
      client.schedule(req(i));
      await vi.advanceTimersByTimeAsync(10);
      clock += 1000;
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onSkipped).toHaveBeenCalledTimes(2);
    expect(onSkipped.mock.calls[0]?.[0]).toBe("budget");
    expect(client.budget().remaining).toBe(0);
    // The window rolls forward.
    clock += 60_000;
    expect(client.budget().remaining).toBe(2);
    client.schedule(req(5));
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("parks on a 429 until retry_after has passed", async () => {
    let clock = 2_000_000;
    const fetchImpl = vi.fn(async () =>
      fetchImpl.mock.calls.length === 1
        ? Response.json({ error: "analyzer_rate_limited", retry_after: 30 }, { status: 429 })
        : ok(),
    );
    const onError = vi.fn();
    const onSkipped = vi.fn();
    const client = createAnalyzerClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      debounceMs: 5,
      callsPerMinute: 10,
      now: () => clock,
      onResult: vi.fn(),
      onError,
      onSkipped,
    });
    client.schedule(req(1));
    await vi.advanceTimersByTimeAsync(10);
    expect(onError).toHaveBeenCalledWith("analyzer rate limited", req(1));
    expect(client.budget().cooldownUntil).toBe(clock + 30_000);
    clock += 10_000;
    client.schedule(req(2));
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onSkipped).toHaveBeenCalledWith("cooldown", req(2));
    clock += 25_000;
    client.schedule(req(3));
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
