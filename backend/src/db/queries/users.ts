import { eq } from 'drizzle-orm';
import type { Db } from '../index';
import { users } from '../schema';
import { isUniqueViolation } from '../pg-errors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type CreateUserData = {
  keycloak_id: string;
  email: string;
  name: string;
  avatar_url?: string | null;
  preferences?: Record<string, unknown>;
};

export type UpdateUserData = Partial<{
  email: string;
  name: string;
  avatar_url: string | null;
  preferences: Record<string, unknown>;
}>;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Look up a user by their Keycloak subject identifier.
 * Returns `undefined` if not found.
 */
export async function getUserByKeycloakId(
  db: Db,
  keycloakId: string,
): Promise<User | undefined> {
  const results = await db
    .select()
    .from(users)
    .where(eq(users.keycloak_id, keycloakId))
    .limit(1);

  return results[0];
}

/**
 * Create a new user row and return the full record.
 */
export async function createUser(db: Db, data: CreateUserData): Promise<User> {
  const [created] = await db
    .insert(users)
    .values({
      keycloak_id: data.keycloak_id,
      email: data.email,
      name: data.name,
      avatar_url: data.avatar_url ?? null,
      preferences: data.preferences ?? {},
    })
    .returning();

  if (!created) throw new Error('createUser: insert returned no rows');
  return created;
}

/**
 * Update mutable fields on a user identified by keycloakId.
 * Returns the updated record.
 */
export async function updateUser(
  db: Db,
  keycloakId: string,
  data: UpdateUserData,
): Promise<User> {
  const [updated] = await db
    .update(users)
    .set({ ...data, updated_at: new Date() })
    .where(eq(users.keycloak_id, keycloakId))
    .returning();

  if (!updated) throw new Error(`updateUser: no user found for keycloakId=${keycloakId}`);
  return updated;
}

/** DB-level unique index on lower(email) (DATA-02). */
export const USERS_EMAIL_UNIQUE_IDX = 'users_email_unique_idx';

/**
 * The token's email already belongs to a different app user (different
 * keycloak_id) — e.g. a recreated realm or migrated IdP issuing new subject
 * ids. Never auto-merged: relinking by email would let whoever controls that
 * address take over the old account.
 */
export class EmailConflictError extends Error {
  constructor() {
    super('Email already belongs to another account');
    this.name = 'EmailConflictError';
  }
}

export type UserClaims = {
  keycloak_id: string;
  /** Empty string when the token carries no email claim. */
  email: string;
  name: string;
};

/**
 * Provision-or-refresh the app user for an authenticated request.
 *
 * - Cheap for existing users (review S2): one SELECT by keycloak_id. Only
 *   on a miss do we INSERT, so the common request makes one round-trip and
 *   never consumes a users_id_seq value.
 * - Race-safe first login (BUG-03): the INSERT is `ON CONFLICT (keycloak_id)
 *   DO NOTHING` followed by a re-select, so near-simultaneous first requests
 *   (all of which missed the SELECT) never hit the unique index and 500.
 * - Keycloak is the source of truth for identity (BUG-08): if the token's
 *   email/name differ from the stored row, the row is updated. Empty claims
 *   never overwrite stored values, and nothing is written when unchanged.
 */
export async function upsertUser(
  db: Db,
  claims: UserClaims,
): Promise<{ user: User; created: boolean }> {
  const existing = await getUserByKeycloakId(db, claims.keycloak_id);
  if (existing) return { user: await refreshProfile(db, existing, claims), created: false };

  let inserted: User | undefined;
  try {
    [inserted] = await db
      .insert(users)
      .values({
        keycloak_id: claims.keycloak_id,
        email: claims.email,
        name: claims.name,
        avatar_url: null,
        preferences: {},
      })
      .onConflictDoNothing({ target: users.keycloak_id })
      .returning();
  } catch (err) {
    if (!isUniqueViolation(err, USERS_EMAIL_UNIQUE_IDX)) throw err;
    // The email index is not the ON CONFLICT arbiter, so a concurrent first
    // request of THIS subject can win between our SELECT and our INSERT and
    // surface here as an email violation. Only if no row has our
    // keycloak_id is the email really another account's (DATA-02).
  }

  if (inserted) return { user: inserted, created: true };

  // Lost a first-login race (ON CONFLICT or the email index): the winner's
  // row is committed by now.
  const winner = await getUserByKeycloakId(db, claims.keycloak_id);
  if (!winner) throw new EmailConflictError();
  return { user: await refreshProfile(db, winner, claims), created: false };
}

/** BUG-08 / DATA-02: bring the stored email/name in line with the token. */
async function refreshProfile(db: Db, existing: User, claims: UserClaims): Promise<User> {
  const changes: UpdateUserData = {};
  if (claims.email && claims.email !== existing.email) changes.email = claims.email;
  if (claims.name && claims.name !== existing.name) changes.name = claims.name;

  if (Object.keys(changes).length === 0) return existing;

  try {
    return await updateUser(db, claims.keycloak_id, changes);
  } catch (err) {
    if (!changes.email || !isUniqueViolation(err, USERS_EMAIL_UNIQUE_IDX)) throw err;
    // Keycloak moved this user to an email another row owns (DATA-02). Keep
    // the stored email so the user can still sign in; refresh the rest.
    console.warn(
      `upsertUser: email refresh for keycloakId=${claims.keycloak_id} conflicts with another account; keeping stored email`,
    );
    delete changes.email;
    if (Object.keys(changes).length === 0) return existing;
    return updateUser(db, claims.keycloak_id, changes);
  }
}
