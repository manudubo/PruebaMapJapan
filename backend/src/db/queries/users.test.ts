import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createUser, EmailConflictError, getUserByKeycloakId, updateUser, upsertUser } from './users';
import { users } from '../schema';
import { closeTestPool, insertUser, resetDb, testDb, testPool } from '../../test-utils/db';

// Real Postgres (ARCH-06): these exercise the actual ON CONFLICT / UPDATE SQL.

const claims = { keycloak_id: 'kc-1', email: 'old@example.com', name: 'Old Name' };

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
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

describe('users.email uniqueness (DATA-02)', () => {
  it('a new subject whose email another account owns → EmailConflictError, no row', async () => {
    await insertUser({ keycloak_id: 'kc-old', email: 'ana@example.com' });

    await expect(
      upsertUser(testDb(), { keycloak_id: 'kc-new', email: 'ana@example.com', name: 'Ana' }),
    ).rejects.toBeInstanceOf(EmailConflictError);
    expect(await getUserByKeycloakId(testDb(), 'kc-new')).toBeUndefined();
  });

  it('is case-insensitive', async () => {
    await insertUser({ email: 'Ana@Example.com' });
    await expect(
      upsertUser(testDb(), { keycloak_id: 'kc-new', email: 'ana@EXAMPLE.COM', name: 'Ana' }),
    ).rejects.toBeInstanceOf(EmailConflictError);
  });

  it('allows any number of users without an email claim (empty string)', async () => {
    for (const kc of ['kc-1', 'kc-2', 'kc-3']) {
      await expect(upsertUser(testDb(), { keycloak_id: kc, email: '', name: kc })).resolves.toMatchObject({ created: true });
    }
    expect(await userRows()).toHaveLength(3);
  });

  it('the same subject logging in again with its own email is not a conflict', async () => {
    await upsertUser(testDb(), claims);
    await expect(upsertUser(testDb(), claims)).resolves.toMatchObject({ created: false });
  });

  it("an email refresh into another account's email keeps the stored email but still refreshes the name", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await insertUser({ keycloak_id: 'kc-b', email: 'bob@example.com' });
    await insertUser({ ...claims });

    const { user } = await upsertUser(testDb(), { keycloak_id: 'kc-1', email: 'BOB@example.com', name: 'Renamed' });

    expect(user).toMatchObject({ keycloak_id: 'kc-1', email: 'old@example.com', name: 'Renamed' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('kc-1'));
  });

  it('an email-only refresh conflict returns the stored row unchanged (user can still sign in)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await insertUser({ keycloak_id: 'kc-b', email: 'bob@example.com' });
    const existing = await insertUser({ ...claims });

    const { user } = await upsertUser(testDb(), { ...claims, email: 'bob@example.com' });

    expect(user).toEqual(existing);
  });

  it('two new subjects racing for the same email → exactly one wins, the other gets EmailConflictError', async () => {
    const results = await Promise.allSettled(
      ['kc-x', 'kc-y', 'kc-z'].map((kc) =>
        upsertUser(testDb(), { keycloak_id: kc, email: 'same@example.com', name: kc }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(EmailConflictError);
    expect(await userRows()).toHaveLength(1);
  });

  it('a direct duplicate insert is rejected by the database itself', async () => {
    await insertUser({ email: 'dup@example.com' });
    await expect(
      testPool().query(`INSERT INTO users (keycloak_id, email, name) VALUES ('kc-dup', 'DUP@example.com', 'x')`),
    ).rejects.toMatchObject({ code: '23505', constraint: 'users_email_unique_idx' });
  });
});
