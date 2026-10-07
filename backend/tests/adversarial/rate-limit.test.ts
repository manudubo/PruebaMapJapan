/**
 * Adversarial: abuse rate limits on the real app (real JWT verification,
 * real Postgres), with the client address supplied the way @hono/node-server
 * does (`incoming.socket.remoteAddress`) and forwarding headers under the
 * operator's TRUSTED_PROXY_HOPS setting.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/index';
import {
  MemoryRateLimitStore,
  POLICIES,
  __resetRateLimitsForTests,
  __setRateLimitingEnabledForTests,
} from '../../src/middleware/rate-limit';
import {
  buildTree,
  client,
  createSigner,
  createTestDatabase,
  dropTestDatabase,
  installFakeNetwork,
  makeEnv,
  makeUser,
  type FakeNetwork,
  type Signer,
} from './harness';
import type { Env } from '../../src/types';

let dbUrl: string;
let signer: Signer;
let net: FakeNetwork;
let store: MemoryRateLimitStore;

/** Env for a request arriving from TCP peer `peer`. */
function envFrom(peer: string, extra: Record<string, string> = {}): Env {
  return { ...makeEnv(dbUrl, { ENVIRONMENT: 'development', ...extra }), incoming: { socket: { remoteAddress: peer } } } as unknown as Env;
}

async function hit(path: string, env: Env, init: RequestInit = {}) {
  const res = await app.request(path, init, env);
  await res.arrayBuffer();
  return res;
}

beforeAll(async () => {
  dbUrl = await createTestDatabase('ratelimit');
  signer = await createSigner();
});

afterAll(async () => {
  await dropTestDatabase(dbUrl);
});

beforeEach(() => {
  __setRateLimitingEnabledForTests(true);
  store = __resetRateLimitsForTests();
  net = installFakeNetwork([signer]);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  __setRateLimitingEnabledForTests(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('health / public endpoints', () => {
  it('10 000-request burst on /api/health from one address: only the policy limit passes', async () => {
    const env = envFrom('203.0.113.10');
    const statuses = await Promise.all(Array.from({ length: 10_000 }, () => hit('/api/health', env).then((r) => r.status)));
    expect(statuses.filter((s) => s === 200)).toHaveLength(POLICIES.healthPerIp.limit);
    expect(statuses.filter((s) => s === 429)).toHaveLength(10_000 - POLICIES.healthPerIp.limit);
    // Another client is unaffected.
    expect((await hit('/api/health', envFrom('203.0.113.11'))).status).toBe(200);
  });

  it('hops=0: rotating spoofed X-Forwarded-For / X-Real-IP / CF-Connecting-IP does not reset the bucket', async () => {
    const env = envFrom('203.0.113.12');
    const statuses: number[] = [];
    for (let i = 0; i < 200; i++) {
      const ip = `10.${i >> 8}.${i & 255}.1`;
      const res = await hit('/api/health', env, {
        headers: { 'X-Forwarded-For': ip, 'X-Real-IP': ip, 'CF-Connecting-IP': ip },
      });
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(POLICIES.healthPerIp.limit);
  });

  it('hops=2 (Funnel → Caddy): attacker-controlled left-most XFF entries do not reset the bucket', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 200; i++) {
      const env = envFrom('172.18.0.2', { TRUSTED_PROXY_HOPS: '2' });
      // "<spoofed>, <real client written by Funnel>, <Funnel written by Caddy>"
      const xff = `9.9.${i & 255}.${i >> 8}, 198.51.100.77, 100.64.0.1`;
      statuses.push((await hit('/api/health', env, { headers: { 'X-Forwarded-For': xff } })).status);
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(POLICIES.healthPerIp.limit);
    // A different real client behind the same proxy has its own bucket.
    const other = await hit('/api/health', envFrom('172.18.0.2', { TRUSTED_PROXY_HOPS: '2' }), {
      headers: { 'X-Forwarded-For': '198.51.100.78, 100.64.0.1' },
    });
    expect(other.status).toBe(200);
  });

  it('public slug enumeration is cut off before the database', async () => {
    const env = envFrom('203.0.113.13');
    const statuses: number[] = [];
    for (let i = 0; i < 100; i++) {
      const slug = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      statuses.push((await hit(`/api/public/trips/${slug}`, env)).status);
    }
    expect(statuses.filter((s) => s === 404)).toHaveLength(POLICIES.publicPerIp.limit);
    expect(statuses.filter((s) => s === 429)).toHaveLength(100 - POLICIES.publicPerIp.limit);
  });

  it('429 carries CORS headers so the SPA can read Retry-After', async () => {
    const env = envFrom('203.0.113.14');
    let last: Response | undefined;
    for (let i = 0; i <= POLICIES.healthPerIp.limit; i++) {
      last = await hit('/api/health', env, { headers: { Origin: 'https://manudubo.github.io' } });
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get('Access-Control-Allow-Origin')).toBe('https://manudubo.github.io');
    expect(Number(last!.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(last!.headers.get('X-Request-Id')).toBeTruthy();
  });
});

describe('authenticated abuse', () => {
  it('OTP request: per-user limit holds even when the attacker spreads over many IPs', async () => {
    const u = await makeUser(signer);
    const errors: unknown[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await client(envFrom(`198.51.100.${i + 1}`))('POST', '/api/auth/otp-request', { token: u.token });
      errors.push(res.status === 201 ? 'ok' : res.body.error);
    }
    // First succeeds, then the DB-level otp_pending answers, and after the
    // per-user budget the limiter answers before any DB work.
    const n = POLICIES.otpRequestPerUser.limit;
    expect(errors[0]).toBe('ok');
    expect(errors.slice(1, n).every((e) => e === 'otp_pending')).toBe(true);
    expect(errors.slice(n).every((e) => e === 'rate_limited')).toBe(true);
    expect(net.mails).toHaveLength(1);
  });

  it('OTP request: per-IP limit applies before token verification (garbage tokens cost no JWKS fetch)', async () => {
    const env = envFrom('203.0.113.20');
    const before = net.jwksFetches;
    const statuses: number[] = [];
    for (let i = 0; i < 100; i++) {
      const res = await hit('/api/auth/otp-request', env, { method: 'POST', headers: { Authorization: 'Bearer x.y.z' } });
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 401)).toHaveLength(POLICIES.otpRequestPerIp.limit);
    expect(statuses.filter((s) => s === 429)).toHaveLength(100 - POLICIES.otpRequestPerIp.limit);
    expect(net.jwksFetches - before).toBeLessThanOrEqual(1);
  });

  it('OTP verify: per-user guesses are capped across IPs (on top of the 5-per-code DB cap)', async () => {
    const u = await makeUser(signer);
    await hit('/api/auth/otp-request', envFrom('198.51.100.200'), { method: 'POST', headers: { Authorization: `Bearer ${u.token}` } });
    const errors: unknown[] = [];
    for (let i = 0; i < 40; i++) {
      const res = await client(envFrom(`192.0.2.${i + 1}`))('POST', '/api/auth/otp-verify', {
        token: u.token,
        body: { code: '000000' },
      });
      errors.push(res.body.error);
    }
    expect(errors.slice(POLICIES.otpVerifyPerUser.limit).every((e) => e === 'rate_limited')).toBe(true);
    expect(errors.slice(0, POLICIES.otpVerifyPerUser.limit)).not.toContain('rate_limited');
  });

  it('trip creation: per-user cap, other users unaffected', async () => {
    const u = await makeUser(signer);
    const v = await makeUser(signer);
    const req = client(envFrom('198.51.100.30'));
    const statuses: number[] = [];
    for (let i = 0; i < POLICIES.tripCreatePerUser.limit + 5; i++) {
      statuses.push((await req('POST', '/api/trips', { token: u.token, body: { name: `t${i}` } })).status);
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(POLICIES.tripCreatePerUser.limit);
    expect(statuses.slice(-5).every((s) => s === 429)).toBe(true);
    expect((await req('POST', '/api/trips', { token: v.token, body: { name: 'ok' } })).status).toBe(201);
  });

  it('a realistic editing session (trip + destination + day + 40 activities + reads) is never limited', async () => {
    const u = await makeUser(signer);
    const req = client(envFrom('198.51.100.40'));
    const tree = await buildTree(req, u.token, 40);
    for (let i = 0; i < 50; i++) {
      expect((await req('GET', `/api/trips/${tree.tripId}`, { token: u.token })).status).toBe(200);
    }
  });

  it('memory stays bounded under a distinct-key flood', async () => {
    for (let i = 0; i < 5000; i++) await hit('/api/health', envFrom(`2001:db8:${(i >> 8).toString(16)}:${(i & 255).toString(16)}::1`));
    expect(store.size).toBeLessThanOrEqual(50_000);
    // Each /64 counted once per policy (api-ip + health-ip).
    expect(store.size).toBe(2 * 5000);
  });
});
