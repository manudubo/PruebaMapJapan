import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context, Next } from 'hono';

// Route-level SEC-07 tests. The OTP queries are replaced by an in-memory
// store that mimics Postgres semantics: each statement is atomic, but reads
// and writes interleave across concurrent requests (every call yields to the
// event loop first). A read-check-then-increment flow therefore lets every
// concurrent request through; the atomic consumeOtpAttempt flow does not.
// The real-Postgres race is covered in db/queries/otp-attempts.test.ts.

// The DB is mocked: skip dbMiddleware's schema-readiness query.
vi.mock('../db/schema-check', () => ({ schemaStatus: async () => [] }));
vi.mock('../middleware/auth', () => ({
  authMiddleware: async (c: Context, next: Next) => {
    c.set('user', { sub: 'kc-1', email: 'user@example.com', name: 'U', preferred_username: 'u' });
    await next();
  },
}));
vi.mock('../middleware/user', () => ({
  ensureUserProvisioned: async (c: Context, next: Next) => {
    c.set('dbUserId', 1);
    await next();
  },
}));

interface Row {
  id: number;
  user_id: number;
  code_hash: string;
  expires_at: Date;
  used_at: Date | null;
  attempts: number;
  created_at: Date;
}

const store = vi.hoisted(() => ({ rows: [] as Row[], nextId: 1, compareCalls: 0 }));
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

vi.mock('../db/queries/otp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/otp')>();
  return {
    ...actual,
    getLatestUnexpiredOtp: vi.fn(async (_db: unknown, userId: number) => {
      await tick();
      const now = Date.now();
      const row = store.rows
        .filter((r) => r.user_id === userId && r.expires_at.getTime() > now && r.used_at === null)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
      return row ? { ...row } : undefined; // snapshot, like a SELECT
    }),
    consumeOtpAttempt: vi.fn(async (_db: unknown, id: number) => {
      await tick();
      const row = store.rows.find((r) => r.id === id);
      if (!row || row.used_at !== null || row.attempts >= actual.OTP_MAX_ATTEMPTS) return null;
      row.attempts += 1;
      return row.attempts;
    }),
    markOtpUsed: vi.fn(async (_db: unknown, id: number) => {
      await tick();
      const row = store.rows.find((r) => r.id === id);
      if (row) row.used_at = new Date();
    }),
    markOtpUsedIfUnused: vi.fn(async (_db: unknown, id: number) => {
      await tick();
      const row = store.rows.find((r) => r.id === id);
      if (!row || row.used_at !== null) return false;
      row.used_at = new Date();
      return true;
    }),
    // Mirrors otp_issue() (migration 0009): one atomic step — no tick
    // between the checks and the insert, as the advisory lock guarantees.
    issueOtp: vi.fn(async (_db: unknown, userId: number, code_hash: string) => {
      await tick();
      const now = Date.now();
      const mine = store.rows.filter((r) => r.user_id === userId);
      const pending = mine
        .filter((r) => r.expires_at.getTime() > now && r.used_at === null)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
      if (pending) {
        return { status: 'otp_pending' as const, retryAfter: Math.max(1, Math.ceil((pending.expires_at.getTime() - now) / 1000)) };
      }
      const inWindow = mine.filter((r) => r.created_at.getTime() > now - actual.OTP_CAP_WINDOW_MS);
      if (inWindow.length >= actual.OTP_MAX_PER_HOUR) {
        const oldest = Math.min(...inWindow.map((r) => r.created_at.getTime()));
        return { status: 'otp_rate_limited' as const, retryAfter: Math.max(1, Math.ceil((oldest + actual.OTP_CAP_WINDOW_MS - now) / 1000)) };
      }
      const row: Row = { id: store.nextId++, user_id: userId, code_hash, expires_at: new Date(now + actual.OTP_TTL_MS), used_at: null, attempts: 0, created_at: new Date(now) };
      store.rows.push(row);
      return { status: 'issued' as const, otpId: row.id };
    }),
  };
});

import app from '../index';
import type { Env } from '../types';
import { consumeOtpAttempt, OTP_MAX_ATTEMPTS, OTP_MAX_PER_HOUR } from '../db/queries/otp';

const OTP_SECRET = 'aaaabbbbccccddddeeeeffffaaaabbbbccccddddeeeeffffaaaabbbbccccddd0';
const mockEnv: Env = {
  DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'japan-trip',
  VALID_AUDIENCES: 'japan-trip-frontend',
  KC_ADMIN_CLIENT_ID: 'japan-trip-worker',
  KC_ADMIN_CLIENT_SECRET: 'mock-secret',
  OTP_SECRET,
  ENVIRONMENT: 'development',
};

const CORRECT = '482913';
const WRONG = (i: number) => String(100000 + i).padStart(6, '0');

/** Same HMAC-SHA256 → base64 scheme as hashOtp in routes/auth.ts. */
async function hash(code: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(OTP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function seedOtp(opts: { attempts?: number; expiresInMs?: number; createdAt?: Date } = {}): Promise<Row> {
  const row: Row = {
    id: store.nextId++,
    user_id: 1,
    code_hash: await hash(CORRECT),
    expires_at: new Date(Date.now() + (opts.expiresInMs ?? 10 * 60_000)),
    used_at: null,
    attempts: opts.attempts ?? 0,
    created_at: opts.createdAt ?? new Date(),
  };
  store.rows.push(row);
  return row;
}

async function verify(code: unknown): Promise<{ status: number; error?: string }> {
  const res = await app.request(
    '/api/auth/otp-verify',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) },
    mockEnv,
  );
  const body = (await res.json()) as { success: boolean; error?: string };
  return { status: res.status, error: body.success ? undefined : body.error };
}

function tally(results: { status: number; error?: string }[]) {
  const t: Record<string, number> = {};
  for (const r of results) {
    const k = r.error ?? 'ok';
    t[k] = (t[k] ?? 0) + 1;
  }
  return t;
}

beforeEach(() => {
  store.rows = [];
  store.nextId = 1;
  vi.mocked(consumeOtpAttempt).mockClear();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/auth/otp-verify — sequential semantics', () => {
  it('correct code on the first try succeeds and is single-use', async () => {
    await seedOtp();
    expect(await verify(CORRECT)).toEqual({ status: 200, error: undefined });
    expect(await verify(CORRECT)).toEqual({ status: 400, error: 'otp_not_found' });
  });

  it('4 wrong guesses then the correct one still succeeds (5th attempt)', async () => {
    const row = await seedOtp();
    for (let i = 0; i < 4; i++) expect(await verify(WRONG(i))).toEqual({ status: 400, error: 'invalid_code' });
    expect(await verify(CORRECT)).toEqual({ status: 200, error: undefined });
    expect(row.attempts).toBe(5);
  });

  it('after 5 wrong guesses even the correct code is refused and the code is burned', async () => {
    const row = await seedOtp();
    for (let i = 0; i < 5; i++) await verify(WRONG(i));
    expect(await verify(CORRECT)).toEqual({ status: 429, error: 'max_attempts' });
    expect(row.used_at).not.toBeNull();
    expect(row.attempts).toBe(OTP_MAX_ATTEMPTS);
    // Burned → no longer the latest unexpired code.
    expect(await verify(CORRECT)).toEqual({ status: 400, error: 'otp_not_found' });
  });

  it('expired code → otp_not_found without consuming an attempt', async () => {
    const row = await seedOtp({ expiresInMs: -1 });
    expect(await verify(CORRECT)).toEqual({ status: 400, error: 'otp_not_found' });
    expect(consumeOtpAttempt).not.toHaveBeenCalled();
    expect(row.attempts).toBe(0);
  });

  it('no code at all → otp_not_found', async () => {
    expect(await verify(CORRECT)).toEqual({ status: 400, error: 'otp_not_found' });
  });

  it.each([
    ['too short', '12345'],
    ['too long', '1234567'],
    ['letters', 'abcdef'],
    ['unicode digits', '١٢٣٤٥٦'],
    ['number type', 123456],
    ['null', null],
    ['SQL-ish', "1' OR 1=1"],
    ['1 MB string', '1'.repeat(1_000_000)],
  ])('malformed code (%s) → 400 before any attempt is consumed', async (_l, code) => {
    await seedOtp();
    const res = await verify(code);
    expect(res.status).toBe(400);
    expect(consumeOtpAttempt).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/otp-verify — concurrency (SEC-07)', () => {
  it('30 concurrent wrong guesses: exactly 5 evaluated, 25 max_attempts', async () => {
    const row = await seedOtp();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => verify(WRONG(i))));
    expect(tally(results)).toEqual({ invalid_code: 5, max_attempts: 25 });
    expect(row.attempts).toBe(OTP_MAX_ATTEMPTS);
    expect(row.used_at).not.toBeNull();
  });

  it('attempts counter never exceeds the cap, even across several storms', async () => {
    const row = await seedOtp();
    for (let round = 0; round < 4; round++) {
      await Promise.all(Array.from({ length: 15 }, (_, i) => verify(WRONG(i))));
      expect(row.attempts).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
    }
  });

  it('code with 4 prior attempts + 10 concurrent guesses → only 1 evaluated', async () => {
    await seedOtp({ attempts: 4 });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => verify(WRONG(i))));
    expect(tally(results)).toEqual({ invalid_code: 1, max_attempts: 9 });
  });

  it('10 concurrent submissions of the CORRECT code → never more than one success', async () => {
    // Zero is possible by design: a request that finds the attempts exhausted
    // burns the code (so the user can request a new one), which can land
    // before an in-flight correct attempt commits. Only reachable by someone
    // already holding the user's session; single use is what matters.
    await seedOtp();
    const results = await Promise.all(Array.from({ length: 10 }, () => verify(CORRECT)));
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    expect(results.filter((r) => r.error === undefined || r.error === 'otp_not_found').length).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
    // Nobody else "also" verified: losers see a consumed/exhausted code.
    for (const r of results.filter((x) => x.status !== 200)) {
      expect(['otp_not_found', 'max_attempts']).toContain(r.error);
    }
  });

  it('5 concurrent submissions of the correct code (within the cap) → exactly one success', async () => {
    await seedOtp();
    const results = await Promise.all(Array.from({ length: OTP_MAX_ATTEMPTS }, () => verify(CORRECT)));
    expect(tally(results)).toEqual({ ok: 1, otp_not_found: OTP_MAX_ATTEMPTS - 1 });
  });

  it('brute-force mix (25 wrong + correct) never evaluates more than 5 guesses', async () => {
    await seedOtp();
    const codes = [...Array.from({ length: 25 }, (_, i) => WRONG(i)), CORRECT];
    const results = await Promise.all(codes.map((c) => verify(c)));
    const t = tally(results);
    expect((t['invalid_code'] ?? 0) + (t['ok'] ?? 0)).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
    expect(t['ok'] ?? 0).toBeLessThanOrEqual(1);
  });

  it('expired code under concurrency: nothing is evaluated', async () => {
    await seedOtp({ expiresInMs: -1000 });
    const results = await Promise.all(Array.from({ length: 10 }, () => verify(CORRECT)));
    expect(tally(results)).toEqual({ otp_not_found: 10 });
    expect(consumeOtpAttempt).not.toHaveBeenCalled();
  });
});

describe('OTP request cap + verify attempts combined (BUG-16 × SEC-07)', () => {
  it('a user at the hourly cap with a burned code gets no new code and no more guesses', async () => {
    // Four older codes this hour, plus the current one → cap reached.
    for (let i = 0; i < OTP_MAX_PER_HOUR - 1; i++) {
      const r = await seedOtp({ createdAt: new Date(Date.now() - (50 - i) * 60_000) });
      r.used_at = new Date();
    }
    await seedOtp();

    // Burn the current code with a concurrent storm.
    const storm = await Promise.all(Array.from({ length: 20 }, (_, i) => verify(WRONG(i))));
    expect(tally(storm)).toEqual({ invalid_code: 5, max_attempts: 15 });

    // Requesting a new code is refused by the hourly cap…
    const reqs = await Promise.all(
      Array.from({ length: 5 }, () => app.request('/api/auth/otp-request', { method: 'POST' }, mockEnv)),
    );
    for (const r of reqs) {
      expect(r.status).toBe(429);
      expect(((await r.json()) as { error: string }).error).toBe('otp_rate_limited');
    }
    // …and verification has nothing left to guess against.
    expect(await verify(CORRECT)).toEqual({ status: 400, error: 'otp_not_found' });
    expect(store.rows).toHaveLength(OTP_MAX_PER_HOUR);
  });

  it('a pending code blocks re-issue while its own attempts remain capped', async () => {
    await seedOtp();
    await Promise.all(Array.from({ length: 3 }, (_, i) => verify(WRONG(i))));
    const res = await app.request('/api/auth/otp-request', { method: 'POST' }, mockEnv);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe('otp_pending');
    const rest = await Promise.all(Array.from({ length: 10 }, (_, i) => verify(WRONG(i + 10))));
    expect(tally(rest)).toEqual({ invalid_code: 2, max_attempts: 8 });
  });
});
