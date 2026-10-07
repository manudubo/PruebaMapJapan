import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

vi.mock('./auth', () => import('../test-utils/fake-auth'));

import { closeDbPools } from '../db';
import { errorHandler } from './errors';
import { isUniqueViolation, pgConstraint, pgErrorCode } from '../db/pg-errors';
import { call, snapshotDb } from '../test-utils/app';
import { closeTestPool, insertTrip, insertUser, resetDb, testPool } from '../test-utils/db';

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await closeDbPools();
  await closeTestPool();
});

describe('pgErrorCode / pgConstraint', () => {
  it('reads a driver error directly', () => {
    expect(pgErrorCode({ code: '23505' })).toBe('23505');
  });

  it('looks through Drizzle-style `cause` wrappers', () => {
    const wrapped = new Error('Failed query', { cause: new Error('x', { cause: { code: '23514', constraint: 'c1' } }) });
    expect(pgErrorCode(wrapped)).toBe('23514');
    expect(pgConstraint(wrapped)).toBe('c1');
  });

  it.each([
    ['network errno code', { code: 'ECONNREFUSED' }],
    ['numeric code', { code: 23505 }],
    ['no code', new Error('boom')],
    ['null', null],
    ['string', 'boom'],
  ])('ignores %s', (_l, err) => {
    expect(pgErrorCode(err)).toBeUndefined();
  });

  it('isUniqueViolation needs both SQLSTATE 23505 and the named constraint', () => {
    expect(isUniqueViolation({ code: '23505', constraint: 'a' }, 'a')).toBe(true);
    expect(isUniqueViolation({ code: '23505', constraint: 'b' }, 'a')).toBe(false);
    expect(isUniqueViolation({ code: '23514', constraint: 'a' }, 'a')).toBe(false);
    expect(isUniqueViolation(new Error('x', { cause: { code: '23505', constraint: 'a' } }), 'a')).toBe(true);
  });

  it('terminates on a cyclic cause chain', () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(pgErrorCode(a)).toBeUndefined();
    expect(pgConstraint(a)).toBeUndefined();
  });
});

describe('errorHandler (M-09)', () => {
  function appThrowing(err: unknown) {
    const app = new Hono();
    app.get('/x', () => {
      throw err;
    });
    app.onError(errorHandler);
    return app;
  }

  it('unexpected error → generic 500, logs the original error object, never echoes its message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('relation "secret_table" does not exist');
    const res = await appThrowing(err).request('/x');
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ success: false, error: 'Internal server error', code: 'internal_error' });
    expect(body).not.toContain('secret_table');
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, any>;
    expect(line).toMatchObject({ level: 'error', event: 'http.unhandled_error', method: 'GET', status: 500 });
    expect(line.error.message).toContain('secret_table');
  });

  it('HTTPException keeps its status (e.g. 400 malformed body, 401)', async () => {
    const res = await appThrowing(new HTTPException(401, { message: 'nope' })).request('/x');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'nope' });
  });

  it.each([
    ['22P02', 400, 'invalid_input'],
    ['22003', 400, 'invalid_input'],
    ['22007', 400, 'invalid_input'],
    ['22008', 400, 'invalid_input'],
    ['22001', 400, 'invalid_input'],
    ['22021', 400, 'invalid_input'],
    ['22P05', 400, 'invalid_input'],
    ['23514', 400, 'constraint_violation'],
    ['23505', 409, 'conflict'],
    ['23503', 409, 'conflict'],
  ])('SQLSTATE %s → %i %s (logged as a warning)', async (sqlstate, status, code) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await appThrowing(new Error('wrapped', { cause: { code: sqlstate } })).request('/x');
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ success: false, code });
    expect(warn).toHaveBeenCalled();
  });

  it('other SQLSTATEs (e.g. 42P01 undefined_table) stay a 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await appThrowing(Object.assign(new Error('x'), { code: '42P01' })).request('/x');
    expect(res.status).toBe(500);
  });
});

describe('errors from real routes reach the global handler (M-09)', () => {
  beforeEach(resetDb);

  async function ownerWithTrip() {
    // Claims match fake-auth's, so provisioning does not rewrite the row.
    const owner = await insertUser({ keycloak_id: 'owner', email: 'owner@example.com', name: 'owner' });
    const trip = await insertTrip(owner.id);
    return { owner, trip };
  }

  it('malformed JSON body → 400, not 500', async () => {
    await ownerWithTrip();
    const res = await call('POST', '/api/trips', { sub: 'owner', rawBody: '{"name": ' });
    expect(res.status).toBe(400);
    expect(res.body['success']).toBe(false);
  });

  it.each(['1.5', '99999999999', 'Infinity', '-Infinity'])(
    'trip id %j → 400 invalid_input instead of a DB 500',
    async (id) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await ownerWithTrip();
      const res = await call('GET', `/api/trips/${id}/destinations`, { sub: 'owner' });
      expect(res.status).toBe(400);
    },
  );

  it.each([
    ['numeric overflow', '12345'],
    ['non-numeric text', 'abc'],
  ])('destination lat with %s → 422 from validation (before the DB) and nothing written', async (_l, lat) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { trip } = await ownerWithTrip();
    const before = await snapshotDb();
    const res = await call('POST', `/api/trips/${trip.id}/destinations`, {
      sub: 'owner',
      body: { city_name: 'X', country: 'Y', lat },
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ success: false, code: 'validation_error' });
    expect(await snapshotDb()).toBe(before);
  });

  it('a failing query inside a handler → generic 500 and the real error is logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { trip } = await ownerWithTrip();
    await testPool().query('ALTER TABLE destinations RENAME TO destinations_gone');
    try {
      const res = await call('GET', `/api/trips/${trip.id}/destinations`, { sub: 'owner' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: 'Internal server error', code: 'internal_error' });
      expect(JSON.stringify(log.mock.calls)).toContain('destinations');
    } finally {
      await testPool().query('ALTER TABLE destinations_gone RENAME TO destinations');
    }
  });

  it('a provisioning failure no longer leaks the DB message to the client', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await testPool().query('ALTER TABLE users RENAME TO users_gone');
    try {
      const res = await call('GET', '/api/trips', { sub: 'owner' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: 'Internal server error', code: 'internal_error' });
      expect(JSON.stringify(res.body)).not.toMatch(/users|relation/);
      // …while the real cause is logged server-side.
      expect(JSON.stringify(log.mock.calls.map((c) => String(c[0])))).toMatch(/users/);
      expect(log).toHaveBeenCalled();
    } finally {
      await testPool().query('ALTER TABLE users_gone RENAME TO users');
    }
  });

  it('PATCH of a missing trip is still a clean 404 (no exception path)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await ownerWithTrip();
    const res = await call('PATCH', '/api/trips/999999', { sub: 'owner', body: { name: 'x' } });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Trip not found' });
    expect(log).not.toHaveBeenCalled();
  });
});
