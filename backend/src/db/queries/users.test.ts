import { describe, it, expect } from 'vitest';
import { upsertUser, type User } from './users';

// Minimal stand-in for the Drizzle query builder chains upsertUser uses.
// There is no real test DB in the unit suite yet (ARCH-06, Phase 24), so this
// fake scripts what Postgres would return for each statement.
function fakeDb(opts: {
  insertReturns: User[];
  selectReturns?: User[];
  updateReturns?: User[];
}) {
  const calls = {
    insert: 0,
    select: 0,
    update: 0,
    onConflictTargets: [] as unknown[],
    updateSets: [] as Record<string, unknown>[],
  };
  const db = {
    insert: () => {
      calls.insert++;
      return {
        values: () => ({
          onConflictDoNothing: (cfg: { target: unknown }) => {
            calls.onConflictTargets.push(cfg.target);
            return { returning: async () => opts.insertReturns };
          },
        }),
      };
    },
    select: () => {
      calls.select++;
      return {
        from: () => ({ where: () => ({ limit: async () => opts.selectReturns ?? [] }) }),
      };
    },
    update: () => {
      calls.update++;
      return {
        set: (v: Record<string, unknown>) => {
          calls.updateSets.push(v);
          return { where: () => ({ returning: async () => opts.updateReturns ?? [] }) };
        },
      };
    },
  };
  return { db, calls };
}

function user(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    keycloak_id: 'kc-1',
    email: 'old@example.com',
    name: 'Old Name',
    avatar_url: null,
    preferences: {},
    created_at: new Date(0),
    updated_at: new Date(0),
    ...overrides,
  };
}

const claims = { keycloak_id: 'kc-1', email: 'old@example.com', name: 'Old Name' };

describe('upsertUser — first-login race (BUG-03)', () => {
  it('inserts with ON CONFLICT (keycloak_id) DO NOTHING and reports created', async () => {
    const fresh = user();
    const { db, calls } = fakeDb({ insertReturns: [fresh] });

    const result = await upsertUser(db, claims);

    expect(result).toEqual({ user: fresh, created: true });
    expect(calls.onConflictTargets).toHaveLength(1);
    expect(calls.select).toBe(0);
  });

  it('re-selects the row when a concurrent request won the insert (no 500)', async () => {
    const winner = user({ id: 42 });
    // Losing request: insert hits the conflict and returns no rows.
    const { db, calls } = fakeDb({ insertReturns: [], selectReturns: [winner] });

    const result = await upsertUser(db, claims);

    expect(result).toEqual({ user: winner, created: false });
    expect(calls.select).toBe(1);
    expect(calls.update).toBe(0);
  });

  it('two near-simultaneous calls both resolve to the same user', async () => {
    const row = user({ id: 7 });
    const first = fakeDb({ insertReturns: [row] });
    const second = fakeDb({ insertReturns: [], selectReturns: [row] });

    const [a, b] = await Promise.all([
      upsertUser(first.db, claims),
      upsertUser(second.db, claims),
    ]);

    expect(a.user.id).toBe(7);
    expect(b.user.id).toBe(7);
  });
});

describe('upsertUser — Keycloak profile sync (BUG-08)', () => {
  it('refreshes email and name when they changed in Keycloak', async () => {
    const existing = user();
    const updated = user({ email: 'new@example.com', name: 'New Name' });
    const { db, calls } = fakeDb({
      insertReturns: [],
      selectReturns: [existing],
      updateReturns: [updated],
    });

    const result = await upsertUser(db, {
      keycloak_id: 'kc-1',
      email: 'new@example.com',
      name: 'New Name',
    });

    expect(result).toEqual({ user: updated, created: false });
    expect(calls.update).toBe(1);
    expect(calls.updateSets[0]).toMatchObject({ email: 'new@example.com', name: 'New Name' });
  });

  it('does not write when email and name are unchanged', async () => {
    const existing = user();
    const { db, calls } = fakeDb({ insertReturns: [], selectReturns: [existing] });

    const result = await upsertUser(db, claims);

    expect(result.user).toBe(existing);
    expect(calls.update).toBe(0);
  });

  it('does not blank a stored email when the token has no email claim', async () => {
    const existing = user();
    const { db, calls } = fakeDb({ insertReturns: [], selectReturns: [existing] });

    await upsertUser(db, { keycloak_id: 'kc-1', email: '', name: 'Old Name' });

    expect(calls.update).toBe(0);
  });

  it('updates only the changed field', async () => {
    const existing = user();
    const { db, calls } = fakeDb({
      insertReturns: [],
      selectReturns: [existing],
      updateReturns: [user({ name: 'Renamed' })],
    });

    await upsertUser(db, { keycloak_id: 'kc-1', email: '', name: 'Renamed' });

    expect(calls.updateSets[0]).toHaveProperty('name', 'Renamed');
    expect(calls.updateSets[0]).not.toHaveProperty('email');
  });
});
