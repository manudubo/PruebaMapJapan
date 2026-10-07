import type { Context, MiddlewareHandler } from 'hono';
import { log } from '../observability/logger';
import { clientIp, ipKey } from './client-ip';

/**
 * Abuse rate limiting.
 *
 * Algorithm: sliding-window counter (the previous fixed window's count,
 * weighted by how much of it still overlaps, plus the current window's
 * count). No 2x burst at window boundaries, O(1) memory per key.
 *
 * Storage is behind `RateLimitStore`:
 *  - `MemoryRateLimitStore` (default) — exact for a single Node process (the
 *    self-hosted backend). Bounded: at most `maxKeys` keys, expired keys are
 *    swept and, if still full, the oldest are evicted, so a flood of distinct
 *    keys (IPv6 rotation, random user ids) cannot exhaust memory.
 *  - On Cloudflare Workers the memory store is per isolate, so it only slows
 *    a single attacker down; for real enforcement install a shared store with
 *    `setRateLimitStore()` at module load (e.g. backed by a Durable Object,
 *    Redis/Upstash or the Workers Rate Limiting binding) and/or add Cloudflare
 *    WAF rate-limiting rules in front. The interface is async for that reason.
 */
export interface RateLimitHit {
  /** Weighted count in the sliding window, including this hit. */
  count: number;
  /** Epoch ms when the current fixed window ends. */
  resetAt: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number, now: number): Promise<RateLimitHit> | RateLimitHit;
}

interface Entry {
  windowStart: number;
  count: number;
  prevCount: number;
  windowMs: number;
  /** A 429 for this key was already logged in this window (no log floods). */
  logged: boolean;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly maxKeys = 50_000) {}

  get size(): number {
    return this.entries.size;
  }

  hit(key: string, windowMs: number, now: number): RateLimitHit {
    let e = this.entries.get(key);
    if (!e) {
      this.makeRoom(now);
      e = { windowStart: now - (now % windowMs), count: 0, prevCount: 0, windowMs, logged: false };
      this.entries.set(key, e);
    }
    const start = now - (now % windowMs);
    if (start !== e.windowStart) {
      e.prevCount = start - e.windowStart === windowMs ? e.count : 0;
      e.count = 0;
      e.windowStart = start;
      e.logged = false;
    }
    e.count++;
    const overlap = 1 - (now - start) / windowMs;
    return { count: e.prevCount * overlap + e.count, resetAt: start + windowMs };
  }

  /** Returns true the first time per window (used to log once per key). */
  markLogged(key: string): boolean {
    const e = this.entries.get(key);
    if (!e || e.logged) return false;
    e.logged = true;
    return true;
  }

  private makeRoom(now: number): void {
    if (this.entries.size < this.maxKeys) return;
    for (const [k, e] of this.entries) {
      if (now - e.windowStart >= 2 * e.windowMs) this.entries.delete(k);
    }
    if (this.entries.size < this.maxKeys) return;
    // Still full of live keys: evict the oldest tenth (Map keeps insertion order).
    let drop = Math.max(1, Math.floor(this.maxKeys / 10));
    for (const k of this.entries.keys()) {
      this.entries.delete(k);
      if (--drop === 0) break;
    }
  }
}

let store: RateLimitStore = new MemoryRateLimitStore();
let enabled = true;
let clock: () => number = () => Date.now();

/** Install a shared store (see module comment). Call once at startup. */
export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

/** Test hooks. Never called by production code. */
export function __setRateLimitingEnabledForTests(on: boolean): void {
  enabled = on;
}
export function __resetRateLimitsForTests(opts: { now?: () => number; maxKeys?: number } = {}): MemoryRateLimitStore {
  const s = new MemoryRateLimitStore(opts.maxKeys);
  store = s;
  clock = opts.now ?? (() => Date.now());
  return s;
}

export interface RateLimitPolicy {
  /** Stable name, part of the key and of the 429 log line. */
  name: string;
  limit: number;
  windowMs: number;
  /** What to count by. `null` = skip this policy for the request. */
  key: (c: Context) => string | null;
}

/** Count by client IP (see client-ip.ts); unknown IPs share one bucket. */
export const byIp = (c: Context): string => {
  const ip = clientIp(c);
  return ip ? `ip:${ipKey(ip)}` : 'ip:unknown';
};

/** Count by authenticated Keycloak subject (mount after authMiddleware). */
export const byUser = (c: Context): string | null => {
  const user = (c.get as (k: string) => { sub?: string } | undefined)('user');
  return user?.sub ? `sub:${user.sub}` : null;
};

export function rateLimitedResponse(c: Context, retryAfterS: number) {
  c.header('Retry-After', String(retryAfterS));
  c.header('Cache-Control', 'no-store');
  return c.json({ success: false as const, error: 'rate_limited', retryAfter: retryAfterS }, 429);
}

/**
 * Check one or more policies; the first exceeded one answers 429 with
 * Retry-After. Every policy is counted even when an earlier one is exceeded,
 * so hammering one endpoint cannot keep another bucket fresh.
 */
export function rateLimit(...policies: RateLimitPolicy[]): MiddlewareHandler {
  return async (c, next) => {
    if (!enabled) return next();
    const now = clock();
    let blocked: { policy: RateLimitPolicy; key: string; resetAt: number } | null = null;
    for (const policy of policies) {
      const k = policy.key(c);
      if (k === null) continue;
      const key = `${policy.name}|${k}`;
      let hit: RateLimitHit;
      try {
        hit = await store.hit(key, policy.windowMs, now);
      } catch (err) {
        // A broken shared store must not take the API down: fail open, loudly.
        log.error('ratelimit.store_error', { policy: policy.name, error: err });
        continue;
      }
      if (hit.count > policy.limit && !blocked) blocked = { policy, key, resetAt: hit.resetAt };
    }
    if (!blocked) return next();
    const retryAfter = Math.max(1, Math.ceil((blocked.resetAt - now) / 1000));
    if (!(store instanceof MemoryRateLimitStore) || store.markLogged(blocked.key)) {
      log.warn('ratelimit.exceeded', {
        request_id: (c.get as (k: string) => unknown)('requestId'),
        policy: blocked.policy.name,
        // Bucket kind only (ip/sub/global) — not the address or subject itself.
        bucket: blocked.key.split('|')[1]?.split(':')[0],
        retry_after_s: retryAfter,
      });
    }
    return rateLimitedResponse(c, retryAfter);
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * Limits. Sized for one person planning a trip (a busy editing session is a
 * few hundred calls per hour) with headroom; abuse is what is far beyond.
 */
export const POLICIES = {
  apiPerIp: { name: 'api-ip', limit: 600, windowMs: MIN, key: byIp },
  healthPerIp: { name: 'health-ip', limit: 60, windowMs: MIN, key: byIp },
  publicPerIp: { name: 'public-ip', limit: 60, windowMs: MIN, key: byIp },
  otpRequestPerIp: { name: 'otp-request-ip', limit: 20, windowMs: HOUR, key: byIp },
  otpRequestPerUser: { name: 'otp-request-user', limit: 6, windowMs: 15 * MIN, key: byUser },
  otpVerifyPerIp: { name: 'otp-verify-ip', limit: 60, windowMs: 15 * MIN, key: byIp },
  otpVerifyPerUser: { name: 'otp-verify-user', limit: 15, windowMs: 15 * MIN, key: byUser },
  tripCreatePerIp: { name: 'trip-create-ip', limit: 60, windowMs: HOUR, key: byIp },
  tripCreatePerUser: { name: 'trip-create-user', limit: 30, windowMs: HOUR, key: byUser },
  geocodePerIp: { name: 'geocode-ip', limit: 30, windowMs: MIN, key: byIp },
  geocodePerUser: { name: 'geocode-user', limit: 20, windowMs: MIN, key: byUser },
} satisfies Record<string, RateLimitPolicy>;
