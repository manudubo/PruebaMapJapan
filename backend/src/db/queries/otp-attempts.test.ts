import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { emailOtpCodes } from '../schema';
import {
  consumeOtpAttempt,
  markOtpUsedIfUnused,
  OTP_MAX_ATTEMPTS,
} from './otp';

// ---------------------------------------------------------------------------
// SEC-07 — atomic OTP attempt counter.
//
// 1. SQL shape: always runs (drizzle.mock, no connection) — proves the guard
//    lives in the UPDATE's WHERE clause, not in application code.
// 2. Real race: runs when TEST_DATABASE_URL points at a Postgres server. It
//    creates a throwaway schema, fires many truly concurrent UPDATEs over a
//    pool, and drops the schema afterwards.
// ---------------------------------------------------------------------------

describe('consumeOtpAttempt SQL (SEC-07)', () => {
  const db = drizzle.mock();

  it('is a single conditional UPDATE ... RETURNING', () => {
    // Build the same statement consumeOtpAttempt runs, via a recording db.
    let captured: { sql: string; params: unknown[] } | undefined;
    const recorder = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'update') return Reflect.get(target, prop, receiver);
        return (table: typeof emailOtpCodes) => {
          const builder = target.update(table);
          return {
            set: (v: Parameters<typeof builder.set>[0]) => {
              const s = builder.set(v);
              return {
                where: (w: Parameters<typeof s.where>[0]) => {
                  const q = s.where(w);
                  return {
                    returning: async (r: Parameters<typeof q.returning>[0]) => {
                      captured = q.returning(r).toSQL();
                      return [];
                    },
                  };
                },
              };
            },
          };
        };
      },
    });

    return consumeOtpAttempt(recorder, 42).then((res) => {
      expect(res).toBeNull(); // no row returned → no attempt granted
      const text = captured!.sql.replace(/\s+/g, ' ');
      expect(text).toMatch(/^update "email_otp_codes" set "attempts" = "email_otp_codes"\."attempts" \+ 1/);
      expect(text).toMatch(/where \("email_otp_codes"\."id" = \$\d+ and "email_otp_codes"\."attempts" < \$\d+ and "email_otp_codes"\."used_at" is null\)/);
      expect(text).toMatch(/returning "attempts"$/);
      expect(captured!.params).toEqual([42, OTP_MAX_ATTEMPTS]);
    });
  });

  it('caps at five attempts', () => {
    expect(OTP_MAX_ATTEMPTS).toBe(5);
  });
});

const url = process.env['TEST_DATABASE_URL'];

describe.skipIf(!url)('consumeOtpAttempt against real Postgres (SEC-07)', () => {
  const schemaName = `otp_race_${process.pid}_${Date.now()}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    await admin.query(`
      CREATE TABLE "${schemaName}".email_otp_codes (
        id serial PRIMARY KEY,
        user_id integer NOT NULL,
        code_hash text NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        attempts integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    pool = new pg.Pool({ connectionString: url, max: 20, options: `-c search_path="${schemaName}"` });
    db = drizzle(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin?.end();
  });

  async function newOtp(attempts = 0): Promise<number> {
    const [row] = await db
      .insert(emailOtpCodes)
      .values({ user_id: 1, code_hash: 'h', expires_at: new Date(Date.now() + 600_000), attempts })
      .returning({ id: emailOtpCodes.id });
    return row!.id;
  }

  async function attemptsOf(id: number): Promise<number> {
    const [row] = await db.select({ a: emailOtpCodes.attempts }).from(emailOtpCodes).where(eq(emailOtpCodes.id, id));
    return row!.a;
  }

  it('50 concurrent attempts: exactly 5 granted, counter never exceeds 5', async () => {
    const id = await newOtp();
    const results = await Promise.all(Array.from({ length: 50 }, () => consumeOtpAttempt(db, id)));
    const granted = results.filter((r): r is number => r !== null);
    expect(granted).toHaveLength(OTP_MAX_ATTEMPTS);
    expect(granted.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]); // each slot handed out once
    expect(await attemptsOf(id)).toBe(OTP_MAX_ATTEMPTS);
  });

  it('repeated concurrent storms never push the counter past the cap', async () => {
    const id = await newOtp();
    for (let round = 0; round < 5; round++) {
      await Promise.all(Array.from({ length: 20 }, () => consumeOtpAttempt(db, id)));
      expect(await attemptsOf(id)).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
    }
    expect(await attemptsOf(id)).toBe(OTP_MAX_ATTEMPTS);
  });

  it('a code with 4 attempts used grants exactly one more under concurrency', async () => {
    const id = await newOtp(4);
    const results = await Promise.all(Array.from({ length: 10 }, () => consumeOtpAttempt(db, id)));
    expect(results.filter((r) => r !== null)).toEqual([5]);
  });

  it('a used code grants no attempts', async () => {
    const id = await newOtp();
    expect(await markOtpUsedIfUnused(db, id)).toBe(true);
    const results = await Promise.all(Array.from({ length: 10 }, () => consumeOtpAttempt(db, id)));
    expect(results.every((r) => r === null)).toBe(true);
    expect(await attemptsOf(id)).toBe(0);
  });

  it('a missing code grants nothing', async () => {
    expect(await consumeOtpAttempt(db, 999_999)).toBeNull();
  });

  it('attempts on one code do not affect another', async () => {
    const a = await newOtp();
    const b = await newOtp();
    await Promise.all(Array.from({ length: 10 }, () => consumeOtpAttempt(db, a)));
    expect(await attemptsOf(a)).toBe(5);
    expect(await attemptsOf(b)).toBe(0);
  });

  it('markOtpUsedIfUnused: 20 concurrent callers → exactly one wins', async () => {
    const id = await newOtp();
    const wins = await Promise.all(Array.from({ length: 20 }, () => markOtpUsedIfUnused(db, id)));
    expect(wins.filter(Boolean)).toHaveLength(1);
  });
});
