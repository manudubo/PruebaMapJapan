import { describe, it, expect, vi, afterEach, afterAll, beforeEach } from 'vitest';

vi.mock('../middleware/auth', () => import('../test-utils/fake-auth'));

import { closeDbPools, getDb, type Db } from '.';
import { call } from '../test-utils/app';
import { closeTestPool, testDb, testEnv } from '../test-utils/db';
import { scratchDbAt, type ScratchDb } from '../test-utils/migrations';
import {
  REQUIRED_SCHEMA_OBJECTS,
  SCHEMA_RECHECK_MS,
  checkSchemaReady,
  findMissingSchemaObjects,
  resetSchemaGuardCache,
} from './schema-guard';

// M1 (review): a Worker deployed before `db:migrate` must fail clearly — a 503
// with a stable code and a log line naming what is missing — instead of a
// 500 per request deep inside a query. Run against real databases migrated
// only part of the way, the state production would be in.

let scratch: ScratchDb | undefined;

beforeEach(() => resetSchemaGuardCache());
afterEach(async () => {
  vi.restoreAllMocks();
  await closeDbPools();
  await scratch?.drop();
  scratch = undefined;
});
afterAll(async () => {
  await closeTestPool();
});

function scratchDb(): Db {
  return getDb(scratch!.url, 'pg');
}

describe('findMissingSchemaObjects', () => {
  it('reports nothing on a fully migrated database', async () => {
    expect(await findMissingSchemaObjects(testDb())).toEqual([]);
  });

  it('reports every post-0006 object on a database migrated only to 0003', async () => {
    scratch = await scratchDbAt('0003_add_email_otp_codes');
    expect(await findMissingSchemaObjects(scratchDb())).toEqual([...REQUIRED_SCHEMA_OBJECTS]);
  });

  it('reports the 0007 index, 0008 triggers and 0009 function on a database at 0006', async () => {
    scratch = await scratchDbAt('0006_lat_lng_range_checks');
    expect(await findMissingSchemaObjects(scratchDb())).toEqual([
      'hotels_destination_id_idx (unique)',
      'trigger trips_biz07_date_coherence',
      'trigger destinations_biz07_date_coherence',
      'trigger days_biz07_date_coherence',
      'function otp_issue()',
    ]);
  });

  it('reports only otp_issue() on a database at 0008', async () => {
    scratch = await scratchDbAt('0008_date_coherence');
    expect(await findMissingSchemaObjects(scratchDb())).toEqual(['function otp_issue()']);
  });

  it('a non-unique index with the right name does not satisfy ON CONFLICT and is reported', async () => {
    scratch = await scratchDbAt('0009_otp_issue_atomic');
    await scratch.pool.query('DROP INDEX hotels_destination_id_idx');
    await scratch.pool.query('CREATE INDEX hotels_destination_id_idx ON hotels (destination_id)');
    expect(await findMissingSchemaObjects(scratchDb())).toEqual(['hotels_destination_id_idx (unique)']);
  });

  it('a trigger with the right name on the wrong table is reported', async () => {
    scratch = await scratchDbAt('0009_otp_issue_atomic');
    await scratch.pool.query('DROP TRIGGER days_biz07_date_coherence ON days');
    await scratch.pool.query(
      `CREATE TRIGGER days_biz07_date_coherence BEFORE INSERT ON trips
       FOR EACH ROW EXECUTE FUNCTION biz07_trips_check()`,
    );
    expect(await findMissingSchemaObjects(scratchDb())).toEqual(['trigger days_biz07_date_coherence']);
  });

  it('otp_issue with a different signature is reported (the Worker calls the 5-arg form)', async () => {
    scratch = await scratchDbAt('0009_otp_issue_atomic');
    await scratch.pool.query('DROP FUNCTION otp_issue(integer, text, integer, integer, integer)');
    await scratch.pool.query(`CREATE FUNCTION otp_issue(integer) RETURNS int LANGUAGE sql AS 'SELECT 1'`);
    expect(await findMissingSchemaObjects(scratchDb())).toEqual(['function otp_issue()']);
  });
});

describe('checkSchemaReady (cached, not per request)', () => {
  function countingDb(inner: Db) {
    let calls = 0;
    const db = new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === 'execute') {
          return (...args: unknown[]) => {
            calls++;
            return (target.execute as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    return { db, calls: () => calls };
  }

  it('a ready database is checked once, then never again', async () => {
    const { db, calls } = countingDb(testDb());
    for (let i = 0; i < 5; i++) expect(await checkSchemaReady(db, 'k-ready')).toEqual({ ok: true });
    expect(calls()).toBe(1);
  });

  it('concurrent first requests share one check', async () => {
    const { db, calls } = countingDb(testDb());
    const results = await Promise.all(Array.from({ length: 10 }, () => checkSchemaReady(db, 'k-burst')));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(calls()).toBe(1);
  });

  it('a missing result is cached for SCHEMA_RECHECK_MS, then re-checked (recovers after migrate)', async () => {
    scratch = await scratchDbAt('0006_lat_lng_range_checks');
    const { db, calls } = countingDb(scratchDb());
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect((await checkSchemaReady(db, 'k-miss')).ok).toBe(false);
    expect((await checkSchemaReady(db, 'k-miss')).ok).toBe(false);
    expect(calls()).toBe(1);

    await scratch.migrateToLatest();
    now += SCHEMA_RECHECK_MS - 1;
    expect((await checkSchemaReady(db, 'k-miss')).ok).toBe(false);
    expect(calls()).toBe(1);

    now += 2;
    expect(await checkSchemaReady(db, 'k-miss')).toEqual({ ok: true });
    expect(calls()).toBe(2);
  });

  it('a failing check (DB unreachable) is not cached and does not block the request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const broken = {
      execute: async () => {
        calls++;
        throw new Error('connect ECONNREFUSED');
      },
    } as unknown as Db;
    expect(await checkSchemaReady(broken, 'k-down')).toEqual({ ok: true, unverified: true });
    expect(await checkSchemaReady(broken, 'k-down')).toEqual({ ok: true, unverified: true });
    expect(calls).toBe(2);
    expect(warn).toHaveBeenCalled();
  });
});

describe('Worker on an unmigrated database (dbMiddleware)', () => {
  const ROUTES: [string, string, unknown?][] = [
    ['GET', '/api/users/me'],
    ['GET', '/api/trips'],
    ['POST', '/api/auth/otp-request'],
    ['PUT', '/api/trips/1/destinations/1/hotel', { name: 'H' }],
    ['GET', '/api/public/trips/00000000-0000-0000-0000-000000000000'],
  ];

  it.each(['0003_add_email_otp_codes', '0006_lat_lng_range_checks'])(
    'at %s every DB route answers 503 schema_not_migrated and logs the missing objects',
    async (tag) => {
      scratch = await scratchDbAt(tag);
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const env = testEnv({ DATABASE_URL: scratch.url });
      for (const [method, path, body] of ROUTES) {
        const res = await call(method, path, { sub: 'someone', body, env });
        expect(res.status, `${method} ${path}`).toBe(503);
        expect(res.body).toEqual({
          success: false,
          error: 'Service unavailable',
          code: 'schema_not_migrated',
        });
      }
      const logged = log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).toContain('schema_not_migrated');
      expect(logged).toContain('otp_issue');
      expect(logged).toContain('hotels_destination_id_idx');
      // The client body never names schema objects.
      // Nothing was written: the guard runs before provisioning.
      const { rows } = await scratch.pool.query('SELECT count(*)::int AS n FROM users');
      expect(rows[0].n).toBe(0);
    },
  );

  it('unauthenticated requests still get 401 (auth runs before the guard)', async () => {
    scratch = await scratchDbAt('0003_add_email_otp_codes');
    const res = await call('GET', '/api/trips', { env: testEnv({ DATABASE_URL: scratch.url }) });
    expect(res.status).toBe(401);
  });

  it('serves normally once migrated', async () => {
    const res = await call('GET', '/api/users/me', { sub: 'guard-ok' });
    expect(res.status).toBe(201);
  });
});

describe('GET /api/health/ready', () => {
  it('200 {status:"ready"} on a migrated database', async () => {
    const res = await call('GET', '/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('503 schema_not_migrated on a database at 0003, without naming objects', async () => {
    scratch = await scratchDbAt('0003_add_email_otp_codes');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call('GET', '/api/health/ready', { env: testEnv({ DATABASE_URL: scratch.url }) });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', code: 'schema_not_migrated' });
  });

  it('503 db_unreachable when the readiness check itself cannot run (never "ready" unverified)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await call('GET', '/api/health/ready', {
      env: testEnv({ DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none' }),
    });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', code: 'db_unreachable' });
  });

  it('503 db_unreachable when the database goes away after a cached "ready"', async () => {
    // The schema verdict is cached forever once ready; readiness must still
    // notice a database that stopped answering (uptime checks, deploy waits).
    scratch = await scratchDbAt('0010_reconcile_push_built_schema');
    const env = testEnv({ DATABASE_URL: scratch.url });
    expect((await call('GET', '/api/health/ready', { env })).status).toBe(200);
    await closeDbPools();
    await scratch.drop();
    scratch = undefined;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call('GET', '/api/health/ready', { env });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', code: 'db_unreachable' });
  });

  it('503 config error without DATABASE_URL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call('GET', '/api/health/ready', { env: testEnv({ DATABASE_URL: '' }) });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', code: 'not_configured' });
  });
});
