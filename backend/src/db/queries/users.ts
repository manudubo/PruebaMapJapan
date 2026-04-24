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

/**
 * Insert-or-update a user on every login.
 * If the user already exists their email and name are refreshed; otherwise
 * a new row is created.
 * Returns the user record (existing or freshly created).
 */
export async function upsertUser(
  db: Db,
  keycloakId: string,
  email: string,
  name: string,
): Promise<User> {
  const existing = await getUserByKeycloakId(db, keycloakId);

  if (existing) {
    return updateUser(db, keycloakId, { email, name });
  }

  return createUser(db, { keycloak_id: keycloakId, email, name });
}
