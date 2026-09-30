import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createUser, getUserByKeycloakId, updateUser, upsertUser } from './users';
import { users } from '../schema';
import { closeTestPool, insertUser, resetDb, testDb, testPool } from '../../test-utils/db';

// Real Postgres (ARCH-06): these exercise the actual ON CONFLICT / UPDATE SQL.

const claims = { keycloak_id: 'kc-1', email: 'old@example.com', name: 'Old Name' };

beforeEach(resetDb);
afterAll(closeTestPool);

async function userRows() {
  return testDb().select().from(users);
}

describe('upsertUser — first login (BUG-03)', () => {
  it('creates the user on first call and reports created', async () => {
    const result = await upsertUser(testDb(), claims);

    expect(result.created).toBe(true);
    expect(result.user).toMatchObject({ ...claims, avatar_url: null, preferences: {} });
    expect(await userRows()).toHaveLength(1);
  });

  it('returns the existing row (created=false) on later calls', async () => {
    const first = await upsertUser(testDb(), claims);
    const second = await upsertUser(testDb(), claims);

    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(await userRows()).toHaveLength(1);
  });

  it('10 concurrent first logins on separate connections → one row, one "created", no error', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => upsertUser(testDb(), claims)),
    );

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const values = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof upsertUser>>>).value);
    expect(new Set(values.map((v) => v.user.id)).size).toBe(1);
    expect(values.filter((v) => v.created)).toHaveLength(1);
    expect(await userRows()).toHaveLength(1);
  });

  it('concurrent first logins of different users each get their own row', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        upsertUser(testDb(), { keycloak_id: `kc-${i}`, email: `u${i}@example.com`, name: `U${i}` }),
      ),
    );
    expect(results.every((r) => r.created)).toBe(true);
    expect(new Set(results.map((r) => r.user.id)).size).toBe(6);
  });

  it('round-trips unicode names and emails unchanged', async () => {
    const unicode = { keycloak_id: 'kc-ü', email: 'yamada@例え.jp', name: '山田 太郎 🗾' };
    const { user } = await upsertUser(testDb(), unicode);
    expect(user).toMatchObject(unicode);
    expect(await getUserByKeycloakId(testDb(), 'kc-ü')).toMatchObject(unicode);
  });

  it('accepts a 255-char name and rejects 256 chars (varchar(255)) without writing', async () => {
    await expect(upsertUser(testDb(), { ...claims, name: 'n'.repeat(255) })).resolves.toMatchObject({
      created: true,
    });
    await expect(
      upsertUser(testDb(), { keycloak_id: 'kc-2', email: 'x@example.com', name: 'n'.repeat(256) }),
    ).rejects.toThrow();
    expect(await userRows()).toHaveLength(1);
  });
});

describe('upsertUser — Keycloak profile sync (BUG-08)', () => {
  it('refreshes email and name when they changed in Keycloak', async () => {
    const existing = await insertUser({ ...claims });

    const result = await upsertUser(testDb(), {
      keycloak_id: 'kc-1',
      email: 'new@example.com',
      name: 'New Name',
    });

    expect(result.created).toBe(false);
    expect(result.user).toMatchObject({ id: existing.id, email: 'new@example.com', name: 'New Name' });
    expect(result.user.updated_at.getTime()).toBeGreaterThan(existing.updated_at.getTime());
  });

  it('does not write when email and name are unchanged (updated_at untouched)', async () => {
    const existing = await insertUser({ ...claims });

    const result = await upsertUser(testDb(), claims);

    expect(result.user.updated_at.getTime()).toBe(existing.updated_at.getTime());
  });

  it('does not blank a stored email when the token has no email claim', async () => {
    await insertUser({ ...claims });

    const { user } = await upsertUser(testDb(), { keycloak_id: 'kc-1', email: '', name: 'Old Name' });

    expect(user.email).toBe('old@example.com');
  });

  it('updates only the changed field', async () => {
    await insertUser({ ...claims });

    const { user } = await upsertUser(testDb(), { keycloak_id: 'kc-1', email: '', name: 'Renamed' });

    expect(user).toMatchObject({ email: 'old@example.com', name: 'Renamed' });
  });

  it('never touches another user row', async () => {
    const other = await insertUser({ keycloak_id: 'kc-other', email: 'other@example.com', name: 'Other' });
    await insertUser({ ...claims });

    await upsertUser(testDb(), { keycloak_id: 'kc-1', email: 'new@example.com', name: 'New' });

    const [row] = await testDb().select().from(users).where(eq(users.id, other.id));
    expect(row).toMatchObject({ email: 'other@example.com', name: 'Other' });
  });
});

describe('user query helpers', () => {
  it('getUserByKeycloakId returns undefined for an unknown subject', async () => {
    expect(await getUserByKeycloakId(testDb(), 'missing')).toBeUndefined();
  });

  it('createUser on an existing keycloak_id violates users_keycloak_id_idx (the pre-BUG-03 failure)', async () => {
    await insertUser({ ...claims });
    await expect(createUser(testDb(), claims)).rejects.toThrow();
  });

  it('updateUser throws for an unknown subject and writes nothing', async () => {
    await expect(updateUser(testDb(), 'missing', { name: 'x' })).rejects.toThrow(/no user found/);
    expect((await testPool().query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(0);
  });
});
