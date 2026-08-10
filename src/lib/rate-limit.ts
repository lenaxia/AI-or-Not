import "server-only";

/**
 * In-memory per-IP token-bucket rate limiter.
 *
 * SINGLE-INSTANCE ONLY. For multi-instance, use Redis (e.g. @upstash/ratelimit).
 *
 * Buckets refill continuously at `refillPerHour / 3600` tokens per second.
 * Each `try()` consumes 1 token; returns false when the bucket is empty.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const MINUTES = 60_000;

const buckets = new Map<string, Bucket>();

function refill(bucket: Bucket, capacity: number, perHour: number, now: number) {
  const elapsed = (now - bucket.lastRefill) / 1000;
  const refillRate = perHour / 3600;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillRate);
  bucket.lastRefill = now;
}

const CLEANUP_MS = 5 * MINUTES;

let cleanupStarted = false;
function startCleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  setInterval(() => {
    // Drop buckets the caller marked as stale (orphaned IPs). A full scan
    // every 5 min is fine; the map stays small under normal load.
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastRefill > 30 * MINUTES) {
        buckets.delete(key);
      }
    }
  }, CLEANUP_MS).unref();
}

export interface RateLimitConfig {
  /** Max tokens a bucket can hold (= burst size). */
  capacity: number;
  /** Tokens added per hour (= sustained rate). */
  perHour: number;
  /** Prefix for the key (allows multiple limits in one map). */
  prefix: string;
}

/**
 * Returns true if the request is allowed (and consumes a token),
 * false if rate-limited.
 */
export function rateLimit(
  ip: string,
  config: RateLimitConfig,
): { allowed: boolean; remaining: number } {
  startCleanup();
  const key = `${config.prefix}:${ip}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: config.capacity, lastRefill: now };
    buckets.set(key, bucket);
  } else {
    refill(bucket, config.capacity, config.perHour, now);
  }
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens) };
  }
  return { allowed: false, remaining: 0 };
}

/**
 * Extract a client IP from a Next.js Request. Falls back to a synthetic
 * value for local dev where no forwarding headers are present.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
