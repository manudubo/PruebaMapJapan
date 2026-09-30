/**
 * Helpers for tests that run against the real ephemeral Postgres database
 * created by global-setup.ts (ARCH-06).
 *
 * Test files run one at a time (vitest.config.ts: fileParallelism=false), so
 * `resetDb()` in a beforeEach gives every test an empty schema.
 */
import { inject } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import type { Env } from '../types';

export function testDatabaseUrl(): string {
  return inject('databaseUrl');
}

/** Worker env bound to the test database; `overrides` win. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    DATABASE_URL: testDatabaseUrl(),
    KEYCLOAK_URL: 'http://localhost:8080',
    KEYCLOAK_REALM: 'japan-trip',
    VALID_AUDIENCES: 'japan-trip-frontend',
    KC_ADMIN_CLIENT_ID: 'japan-trip-worker',
    KC_ADMIN_CLIENT_SECRET: 'test-secret',
    OTP_SECRET: 'a3f8c2d1e4b7f0a9d6c3e8b1f4a7d0c2e5b8f3a6d9c0e3b6f1a4d7c0e3b6f1',
    ...overrides,
  };
}

let pool: pg.Pool | undefined;

/** Raw pool on the test database, for fixtures and assertions. */
export function testPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: testDatabaseUrl(), max: 4 });
  return pool;
}

/** Drizzle (node-postgres) handle on the test database. */
export function testDb() {
  return drizzle(testPool(), { schema });
}

export async function closeTestPool(): Promise<void> {
  const p = pool;
  pool = undefined;
  await p?.end();
}

/** Empty every app table and restart ids — call in beforeEach. */
export async function resetDb(): Promise<void> {
  await testPool().query(
    `TRUNCATE users, trips, destinations, hotels, days, activities, email_otp_codes
     RESTART IDENTITY CASCADE`,
  );
}

// ---------------------------------------------------------------------------
// Fixtures — insert rows directly (bypassing the code under test)
// ---------------------------------------------------------------------------

let seq = 0;
const next = () => ++seq;

export async function insertUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const n = next();
  const [row] = await testDb()
    .insert(schema.users)
    .values({ keycloak_id: `kc-${n}`, email: `user${n}@example.com`, name: `User ${n}`, ...overrides })
    .returning();
  return row!;
}

export async function insertTrip(
  userId: number,
  overrides: Partial<typeof schema.trips.$inferInsert> = {},
) {
  const [row] = await testDb()
    .insert(schema.trips)
    .values({ user_id: userId, name: `Trip ${next()}`, ...overrides })
    .returning();
  return row!;
}

export async function insertDestination(
  tripId: number,
  overrides: Partial<typeof schema.destinations.$inferInsert> = {},
) {
  const [row] = await testDb()
    .insert(schema.destinations)
    .values({ trip_id: tripId, city_name: `City ${next()}`, country: 'Japan', ...overrides })
    .returning();
  return row!;
}

export async function insertHotel(
  destinationId: number,
  overrides: Partial<typeof schema.hotels.$inferInsert> = {},
) {
  const [row] = await testDb()
    .insert(schema.hotels)
    .values({ destination_id: destinationId, name: `Hotel ${next()}`, ...overrides })
    .returning();
  return row!;
}

export async function insertDay(
  destinationId: number,
  overrides: Partial<typeof schema.days.$inferInsert> = {},
) {
  const [row] = await testDb()
    .insert(schema.days)
    .values({ destination_id: destinationId, date: '2026-03-01', ...overrides })
    .returning();
  return row!;
}

export async function insertActivity(
  dayId: number,
  overrides: Partial<typeof schema.activities.$inferInsert> = {},
) {
  const [row] = await testDb()
    .insert(schema.activities)
    .values({ day_id: dayId, name: `Activity ${next()}`, ...overrides })
    .returning();
  return row!;
}

/** user → trip → destination (+hotel) → day → activity, all owned by one user. */
export async function insertTripTree(userOverrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const user = await insertUser(userOverrides);
  const trip = await insertTrip(user.id);
  const dest = await insertDestination(trip.id);
  const hotel = await insertHotel(dest.id);
  const day = await insertDay(dest.id);
  const act = await insertActivity(day.id);
  return { user, trip, dest, hotel, day, act };
}
