import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest';

vi.mock('../middleware/auth', () => import('../test-utils/fake-auth'));

import { closeDbPools } from '../db';
import { call, snapshotDb } from '../test-utils/app';
import { closeTestPool, insertTrip, insertUser, resetDb, testEnv, testPool } from '../test-utils/db';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await closeDbPools();
  await closeTestPool();
});

async function userRow(sub: string) {
  const { rows } = await testPool().query('SELECT * FROM users WHERE keycloak_id = $1', [sub]);
  return rows;
}

describe('GET /api/users/me', () => {
  it('first call provisions the user → 201; later calls → 200 with the same row', async () => {
    const first = await call('GET', '/api/users/me', { sub: 'kc-a', headers: { 'x-test-name': 'Ana' } });
    expect(first.status).toBe(201);
    expect(first.body['data']).toMatchObject({ keycloak_id: 'kc-a', email: 'kc-a@example.com', name: 'Ana' });

    const second = await call('GET', '/api/users/me', { sub: 'kc-a', headers: { 'x-test-name': 'Ana' } });
    expect(second.status).toBe(200);
    expect((second.body['data'] as { id: number }).id).toBe((first.body['data'] as { id: number }).id);
    expect(await userRow('kc-a')).toHaveLength(1);
  });

  it('8 concurrent first requests → exactly one 201, the rest 200, one row', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => call('GET', '/api/users/me', { sub: 'kc-race' })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    expect(await userRow('kc-race')).toHaveLength(1);
  });

  it('refreshes email/name from the token on later calls (BUG-08)', async () => {
    await call('GET', '/api/users/me', { sub: 'kc-a' });
    const res = await call('GET', '/api/users/me', {
      sub: 'kc-a',
      headers: { 'x-test-email': 'new@example.com', 'x-test-name': 'Renamed' },
    });
    expect(res.status).toBe(200);
    expect(res.body['data']).toMatchObject({ email: 'new@example.com', name: 'Renamed' });
  });

  it('a token without an email claim provisions the user with an empty email', async () => {
    const res = await call('GET', '/api/users/me', { sub: 'kc-noemail', headers: { 'x-test-email': '' } });
    expect(res.status).toBe(201);
    expect(res.body['data']).toMatchObject({ email: '' });
  });

  it('401 without authentication, nothing written', async () => {
    const before = await snapshotDb();
    expect((await call('GET', '/api/users/me')).status).toBe(401);
    expect(await snapshotDb()).toBe(before);
  });

  it('unreachable database → 500 JSON through the global handler, error logged (M-01)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call('GET', '/api/users/me', {
      sub: 'kc-a',
      env: testEnv({ DATABASE_URL: 'postgresql://nobody:x@127.0.0.1:1/none' }),
    });
    expect(res.status).toBe(500);
    expect(res.body['success']).toBe(false);
    expect(log).toHaveBeenCalled();
  });
});

describe('PATCH /api/users/me', () => {
  it('updates name / avatar / preferences of the caller only', async () => {
    const other = await insertUser({ keycloak_id: 'kc-b', name: 'Bob' });
    await call('GET', '/api/users/me', { sub: 'kc-a' });

    const res = await call('PATCH', '/api/users/me', {
      sub: 'kc-a',
      body: { name: 'Ana María', avatar_url: 'https://example.com/a.png', preferences: { theme: 'dark', langs: ['es', 'ja'] } },
    });
    expect(res.status).toBe(200);
    expect(res.body['data']).toMatchObject({
      name: 'Ana María',
      avatar_url: 'https://example.com/a.png',
      preferences: { theme: 'dark', langs: ['es', 'ja'] },
    });
    expect((await userRow('kc-b'))[0]).toMatchObject({ id: other.id, name: 'Bob' });
  });

  it('404 when the caller has never been provisioned (no row created)', async () => {
    const res = await call('PATCH', '/api/users/me', { sub: 'kc-ghost', body: { name: 'x' } });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'User not found' });
    expect(await userRow('kc-ghost')).toHaveLength(0);
  });

  it('400 for an invalid body, nothing written', async () => {
    await call('GET', '/api/users/me', { sub: 'kc-a' });
    const before = await snapshotDb();
    const res = await call('PATCH', '/api/users/me', { sub: 'kc-a', body: { name: 12 } });
    expect(res.status).toBe(400);
    expect(await snapshotDb()).toBe(before);
  });
});

describe('GET /api/users/me/trips', () => {
  it("returns only the caller's trips and provisions a new caller", async () => {
    const me = await insertUser({ keycloak_id: 'kc-a' });
    const other = await insertUser({ keycloak_id: 'kc-b' });
    const mine = await insertTrip(me.id);
    await insertTrip(other.id);

    const res = await call('GET', '/api/users/me/trips', { sub: 'kc-a' });
    expect(res.status).toBe(200);
    expect((res.body['data'] as { id: number }[]).map((t) => t.id)).toEqual([mine.id]);

    const fresh = await call('GET', '/api/users/me/trips', { sub: 'kc-new' });
    expect(fresh.status).toBe(200);
    expect(fresh.body['data']).toEqual([]);
    expect(await userRow('kc-new')).toHaveLength(1);
  });
});
