import { eq } from 'drizzle-orm';
import type { Db } from '../index';
import { users } from '../schema';

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

export type UserClaims = {
  keycloak_id: string;
  /** Empty string when the token carries no email claim. */
  email: string;
  name: string;
};

/**
 * Provision-or-refresh the app user for an authenticated request.
 *
 * - Race-safe first login (BUG-03): `INSERT ... ON CONFLICT (keycloak_id)
 *   DO NOTHING` followed by a re-select, so near-simultaneous first requests
 *   never hit the unique index and 500.
 * - Keycloak is the source of truth for identity (BUG-08): if the token's
 *   email/name differ from the stored row, the row is updated. Empty claims
 *   never overwrite stored values, and nothing is written when unchanged.
 */
export async function upsertUser(
  db: Db,
  claims: UserClaims,
): Promise<{ user: User; created: boolean }> {
  const [inserted] = await db
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

  if (inserted) return { user: inserted, created: true };

  const existing = await getUserByKeycloakId(db, claims.keycloak_id);
  if (!existing) {
    throw new Error(`upsertUser: no user for keycloakId=${claims.keycloak_id} after conflict`);
  }

  const changes: UpdateUserData = {};
  if (claims.email && claims.email !== existing.email) changes.email = claims.email;
  if (claims.name && claims.name !== existing.name) changes.name = claims.name;

  if (Object.keys(changes).length === 0) return { user: existing, created: false };

  const updated = await updateUser(db, claims.keycloak_id, changes);
  return { user: updated, created: false };
}
