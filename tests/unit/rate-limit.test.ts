import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimit } from "@/lib/server/rate-limit";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimit());

  it("allows up to the limit inside one window and rejects the next call", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 20; i++) expect(rateLimit("ip:a", 20, 60_000, t0 + i)).toBe(true);
    expect(rateLimit("ip:a", 20, 60_000, t0 + 25)).toBe(false);
  });

  it("allows again once the window has elapsed", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 20; i++) rateLimit("ip:b", 20, 60_000, t0);
    expect(rateLimit("ip:b", 20, 60_000, t0 + 59_999)).toBe(false);
    expect(rateLimit("ip:b", 20, 60_000, t0 + 60_000)).toBe(true);
  });

  it("keeps keys independent", () => {
    const t0 = 5_000;
    for (let i = 0; i < 20; i++) rateLimit("ip:c", 20, 60_000, t0);
    expect(rateLimit("ip:c", 20, 60_000, t0)).toBe(false);
    expect(rateLimit("ip:d", 20, 60_000, t0)).toBe(true);
  });
});
