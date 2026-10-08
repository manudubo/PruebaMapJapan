import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';

vi.mock('./auth', () => import('../test-utils/fake-auth'));

import { closeDbPools } from '../db';
import { call } from '../test-utils/app';
import { closeTestPool, resetDb, testEnv } from '../test-utils/db';

afterAll(async () => {
  await closeDbPools();
  await closeTestPool();
});
afterEach(() => vi.restoreAllMocks());

// One representative request per DB-backed router (M-01).
const DB_ROUTES: [string, string, unknown?][] = [
  ['GET', '/api/trips'],
  ['GET', '/api/trips/1/destinations/1/days/1/activities'],
  ['GET', '/api/users/me'],
  ['PATCH', '/api/users/me', { name: 'x' }],
  ['GET', '/api/users/me/trips'],
  ['POST', '/api/auth/otp-request'],
  ['POST', '/api/auth/otp-verify', { code: '123456' }],
  ['GET', '/api/public/trips/00000000-0000-0000-0000-000000000000'],
];

describe('dbMiddleware (M-01)', () => {
  it.each(DB_ROUTES)('%s %s without DATABASE_URL → 500 config error, logged', async (method, path, body) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call(method, path, { sub: 'someone', body, env: testEnv({ DATABASE_URL: '' }) });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Server configuration error' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('DATABASE_URL'));
  });

  it.each(DB_ROUTES.filter(([, p]) => !p.startsWith('/api/public')))(
    '%s %s unauthenticated → 401 even when DATABASE_URL is missing (auth runs first)',
    async (method, path, body) => {
      const res = await call(method, path, { body, env: testEnv({ DATABASE_URL: '' }) });
      expect(res.status).toBe(401);
    },
  );

  it.each(['mysql', 'PG', 'neon-http'])('invalid DB_DRIVER %j → 500 config error, logged, no guessing (ARCH-02)', async (driver) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call('GET', '/api/users/me', { sub: 'someone', env: testEnv({ DB_DRIVER: driver }) });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Server configuration error' });
    expect(String(log.mock.calls[0]?.[0])).toContain('Invalid DB_DRIVER');
  });

  it('DB_DRIVER=pg against the test database serves real data', async () => {
    await resetDb();
    const res = await call('GET', '/api/users/me', { sub: 'someone', env: testEnv({ DB_DRIVER: 'pg' }) });
    expect(res.status).toBe(201);
    expect(res.body['data']).toMatchObject({ keycloak_id: 'someone' });
  });

  it('health endpoints do not require a database', async () => {
    const res = await call('GET', '/api/health', { env: testEnv({ DATABASE_URL: '' }) });
    expect(res.status).toBe(200);
  });
});
