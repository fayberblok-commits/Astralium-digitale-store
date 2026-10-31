/**
 * Rate limiting (Phase 1 upgrade, security §1).
 *
 * Sliding-window limiter with an injectable clock (fully unit-testable).
 * Buckets are keyed by a caller-built string — the point of the design is
 * that sensitive flows key by ACCOUNT/EMAIL in addition to (or instead
 * of) IP, so rotating IPs does not reset the budget, and a shared NAT IP
 * does not lock out unrelated customers on per-account flows.
 *
 * Storage is in-memory per process: correct for the single-instance
 * deployments this store targets today. On a multi-instance deployment
 * the limits become per-instance (documented in docs/SECURITY.md as a
 * remaining risk — the durable login LOCKOUT in security-state.ts is
 * shared via the DB/file store and is not affected by this).
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  hits: number[]; // timestamps (ms), ascending
}

export class SlidingWindowLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxBuckets: number;

  constructor(limit: number, windowMs: number, maxBuckets = 10_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxBuckets = maxBuckets;
  }

  check(key: string, nowMs: number = Date.now()): RateLimitResult {
    const cutoff = nowMs - this.windowMs;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxBuckets) {
        // Memory guard: drop the oldest bucket rather than growing forever.
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      bucket = { hits: [] };
      this.buckets.set(key, bucket);
    }
    while (bucket.hits.length > 0 && bucket.hits[0] <= cutoff) bucket.hits.shift();
    if (bucket.hits.length >= this.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.hits[0] + this.windowMs - nowMs) / 1000));
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    bucket.hits.push(nowMs);
    return { allowed: true, remaining: this.limit - bucket.hits.length, retryAfterSeconds: 0 };
  }

  /** Peek without consuming (e.g. to render a lockout message). */
  peek(key: string, nowMs: number = Date.now()): RateLimitResult {
    const cutoff = nowMs - this.windowMs;
    const bucket = this.buckets.get(key);
    const live = bucket ? bucket.hits.filter((t) => t > cutoff) : [];
    if (live.length >= this.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((live[0] + this.windowMs - nowMs) / 1000)) };
    }
    return { allowed: true, remaining: this.limit - live.length, retryAfterSeconds: 0 };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}

// ─── Named policies (single registry — every route uses these) ──────────────

const MIN = 60_000;
const HOUR = 60 * MIN;

export const rateLimiters = {
  /** Admin login per source IP. */
  adminLoginIp: new SlidingWindowLimiter(20, 10 * MIN),
  /** Admin login per account (email / bootstrap) — independent of IP. */
  adminLoginAccount: new SlidingWindowLimiter(8, 15 * MIN),
  /** Public email-keyed flows per email address — independent of IP. */
  emailFlow: new SlidingWindowLimiter(5, HOUR),
  /** Newsletter subscribe per IP. */
  newsletterIp: new SlidingWindowLimiter(10, HOUR),
  /** Coupon validation per IP (code-guessing defence). */
  couponIp: new SlidingWindowLimiter(30, 10 * MIN),
  /** Receipt / order-document access per IP. */
  receiptIp: new SlidingWindowLimiter(30, 10 * MIN),
  /** "Email my downloads" resend per IP. */
  deliveryEmailIp: new SlidingWindowLimiter(10, HOUR),
  /** Review submission per IP. */
  reviewIp: new SlidingWindowLimiter(10, HOUR),
  /** Support chat per IP. */
  supportIp: new SlidingWindowLimiter(30, 10 * MIN),
  /** Phase 5 upgrade: AI-staff customer chat per IP (model calls cost money). */
  aiChatIp: new SlidingWindowLimiter(20, 10 * MIN),
  /** Phase 5 upgrade: AI-staff owner chat per admin actor. */
  aiOwnerActor: new SlidingWindowLimiter(30, 10 * MIN),
  /** Generic public POST per IP (checkout etc.). */
  publicPostIp: new SlidingWindowLimiter(60, 10 * MIN),
} as const;

export type RateLimiterName = keyof typeof rateLimiters;

/** Standard 429 response for a denied check. */
export function tooManyRequests(result: RateLimitResult): Response {
  return new Response(JSON.stringify({ error: "RATE_LIMITED", retryAfterSeconds: result.retryAfterSeconds }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(result.retryAfterSeconds) },
  });
}
