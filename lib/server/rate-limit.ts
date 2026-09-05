// Fixed-window limiter kept in module memory. On Vercel this is per serverless instance, which is
// enough to blunt token-minting abuse for a demo; it is not a global quota.
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit = 20,
  windowMs = 60_000,
  now: number = Date.now(),
): boolean {
  pruneExpired(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function resetRateLimit(): void {
  buckets.clear();
}

function pruneExpired(now: number): void {
  if (buckets.size < 1000) return;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}
