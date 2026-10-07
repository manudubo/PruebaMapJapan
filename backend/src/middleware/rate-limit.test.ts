import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import {
  MemoryRateLimitStore,
  __resetRateLimitsForTests,
  __setRateLimitingEnabledForTests,
  byIp,
  rateLimit,
  setRateLimitStore,
  type RateLimitPolicy,
} from './rate-limit';

let now = 60_000 * 16_666_667; // aligned to a whole minute
const clock = () => now;

beforeEach(() => {
  now = 60_000 * 16_666_667;
  __setRateLimitingEnabledForTests(true);
  __resetRateLimitsForTests({ now: clock });
});

afterEach(() => {
  __setRateLimitingEnabledForTests(false);
  vi.restoreAllMocks();
});

describe('MemoryRateLimitStore (sliding window)', () => {
  it('counts within a window and resets after it', () => {
    const s = new MemoryRateLimitStore();
    for (let i = 1; i <= 5; i++) expect(s.hit('k', 60_000, now).count).toBe(i);
    // Two full windows later nothing remains.
    expect(s.hit('k', 60_000, now + 120_000).count).toBe(1);
  });

  it('no 2x burst at the boundary: the previous window still weighs in', () => {
    const s = new MemoryRateLimitStore();
    for (let i = 0; i < 10; i++) s.hit('k', 60_000, now + 59_000);
    // 1 s into the next window ~ 98% of the previous count still applies.
    expect(s.hit('k', 60_000, now + 61_000).count).toBeGreaterThan(10);
    // Half-way through it is ~half.
    expect(s.hit('k', 60_000, now + 90_000).count).toBeCloseTo(10 * 0.5 + 2, 5);
  });

  it('keys are independent', () => {
    const s = new MemoryRateLimitStore();
    s.hit('a', 60_000, now);
    s.hit('a', 60_000, now);
    expect(s.hit('b', 60_000, now).count).toBe(1);
  });

  it('memory is bounded: 100 000 distinct keys never exceed maxKeys', () => {
    const s = new MemoryRateLimitStore(1000);
    for (let i = 0; i < 100_000; i++) s.hit(`ip:${i}`, 60_000, now);
    expect(s.size).toBeLessThanOrEqual(1000);
  });

  it('expired keys are swept before live ones are evicted', () => {
    const s = new MemoryRateLimitStore(10);
    for (let i = 0; i < 9; i++) s.hit(`old${i}`, 60_000, now);
    s.hit('live', 60_000, now + 150_000);
    for (let i = 0; i < 5; i++) s.hit(`new${i}`, 60_000, now + 150_000);
    expect(s.hit('live', 60_000, now + 150_000).count).toBe(2); // kept
  });
});

function appWith(...policies: RateLimitPolicy[]) {
  const app = new Hono();
  app.use('*', rateLimit(...policies));
  app.get('/x', (c) => c.json({ ok: true }));
  return app;
}
const peerEnv = (ip: string) => ({ incoming: { socket: { remoteAddress: ip } } });

describe('rateLimit middleware', () => {
  const p: RateLimitPolicy = { name: 't', limit: 3, windowMs: 60_000, key: byIp };

  it('allows `limit` requests, then 429 with Retry-After and a generic body', async () => {
    const app = appWith(p);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 3; i++) expect((await app.request('/x', {}, peerEnv('198.51.100.1'))).status).toBe(200);
    now += 15_000;
    const res = await app.request('/x', {}, peerEnv('198.51.100.1'));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('45');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ success: false, error: 'rate_limited', retryAfter: 45 });
  });

  it('a different IP is unaffected', async () => {
    const app = appWith(p);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 5; i++) await app.request('/x', {}, peerEnv('198.51.100.1'));
    expect((await app.request('/x', {}, peerEnv('198.51.100.2'))).status).toBe(200);
  });

  it('IPv6 rotation inside one /64 shares a bucket', async () => {
    const app = appWith(p);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const statuses: number[] = [];
    for (let i = 1; i <= 10; i++) statuses.push((await app.request('/x', {}, peerEnv(`2001:db8:1:2::${i.toString(16)}`))).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
  });

  it('10 000-request burst: exactly `limit` pass, one log line, no log flood', async () => {
    const app = appWith({ ...p, limit: 50 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const results = await Promise.all(
      Array.from({ length: 10_000 }, async () => (await app.request('/x', {}, peerEnv('203.0.113.66'))).status),
    );
    expect(results.filter((s) => s === 200)).toHaveLength(50);
    expect(results.filter((s) => s === 429)).toHaveLength(9950);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('ratelimit.exceeded'));
    expect(lines).toHaveLength(1);
    // The log names the bucket kind, never the address.
    expect(lines[0]).not.toContain('203.0.113.66');
    expect(JSON.parse(lines[0]!)).toMatchObject({ policy: 't', bucket: 'ip' });
  });

  it('every policy is counted even when an earlier one blocks', async () => {
    const a: RateLimitPolicy = { name: 'a', limit: 1, windowMs: 60_000, key: byIp };
    const b: RateLimitPolicy = { name: 'b', limit: 3, windowMs: 60_000, key: byIp };
    const app = appWith(a, b);
    const appB = appWith(b);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 3; i++) await app.request('/x', {}, peerEnv('198.51.100.3'));
    // b already saw 3 hits through `app`, so the 4th via appB is blocked.
    expect((await appB.request('/x', {}, peerEnv('198.51.100.3'))).status).toBe(429);
  });

  it('a policy whose key is null is skipped', async () => {
    const app = appWith({ name: 'n', limit: 0, windowMs: 60_000, key: () => null });
    expect((await app.request('/x')).status).toBe(200);
  });

  it('unknown client IP: all such requests share one bucket (fail closed, not open)', async () => {
    const app = appWith(p);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await app.request('/x', { headers: { 'X-Forwarded-For': `6.6.6.${i}` } }, {})).status);
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
  });

  it('a failing shared store fails open and logs', async () => {
    setRateLimitStore({
      hit: () => {
        throw new Error('redis down');
      },
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = appWith({ ...p, limit: 0 });
    expect((await app.request('/x', {}, peerEnv('198.51.100.4'))).status).toBe(200);
    expect(String(err.mock.calls[0]?.[0])).toContain('ratelimit.store_error');
  });

  it('an async shared store is supported', async () => {
    const mem = new MemoryRateLimitStore();
    setRateLimitStore({ hit: async (k, w, t) => mem.hit(k, w, t) });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = appWith(p);
    const s: number[] = [];
    for (let i = 0; i < 4; i++) s.push((await app.request('/x', {}, peerEnv('198.51.100.5'))).status);
    expect(s).toEqual([200, 200, 200, 429]);
  });
});
