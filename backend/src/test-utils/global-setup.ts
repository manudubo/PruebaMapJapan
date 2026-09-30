/**
 * Vitest globalSetup — ephemeral Postgres database for the backend suite (ARCH-06).
 *
 * TEST_DATABASE_URL points at a Postgres *server* (any database the role can
 * connect to, usually `postgres`). For each run we CREATE a uniquely named
 * database, apply every migration in src/db/migrations with Drizzle's
 * migrator (the same path as `npm run db:migrate`), hand its URL to the test
 * files via `provide`, and DROP it on teardown.
 *
 * No real server → the run fails with instructions. Tests are never skipped:
 * a skipped DB test is a green test that verified nothing.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { GlobalSetupContext } from 'vitest/node';

export const DEFAULT_TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/postgres';

export const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../db/migrations',
);

/** Same server/credentials as `serverUrl`, different database name. */
export function withDatabase(serverUrl: string, database: string): string {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

export function uniqueDatabaseName(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${process.pid}_${rand}`;
}

export async function createDatabase(serverUrl: string, name: string): Promise<string> {
  const admin = new pg.Client({ connectionString: serverUrl });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `Backend tests need a real Postgres server (ARCH-06). Could not connect to ` +
        `TEST_DATABASE_URL=${redact(serverUrl)}: ${(err as Error).message}\n` +
        `Start one with \`docker compose -f keycloak/docker-compose.yml up -d postgres\` ` +
        `or point TEST_DATABASE_URL at any Postgres 16 server whose role may CREATE DATABASE.`,
    );
  }
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  return withDatabase(serverUrl, name);
}

export async function dropDatabase(serverUrl: string, name: string): Promise<void> {
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(unparseable URL)';
  }
}

export default async function setup({ provide }: GlobalSetupContext) {
  const serverUrl = process.env['TEST_DATABASE_URL'] ?? DEFAULT_TEST_DATABASE_URL;
  const name = uniqueDatabaseName('travelmap_test');
  const databaseUrl = await createDatabase(serverUrl, name);

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }

  provide('databaseUrl', databaseUrl);
  provide('serverDatabaseUrl', serverUrl);

  return async () => {
    await dropDatabase(serverUrl, name);
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** Migrated, per-run database shared by every test file. */
    databaseUrl: string;
    /** Server-level URL, for tests that need their own scratch database. */
    serverDatabaseUrl: string;
  }
}
