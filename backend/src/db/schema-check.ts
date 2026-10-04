import { sql } from 'drizzle-orm';
import type { Db } from './index';

// ---------------------------------------------------------------------------
// Schema readiness: is the database at least at the migration level this
// Worker's code needs?
//
// Deploying the Worker before `npm run db:migrate` (or restoring an old
// backup) used to fail silently: OTP requests 500 without 0009, hotel PUTs
// 500 without 0007, and without 0008 the BIZ-07 date rules are simply off.
// dbMiddleware runs this check once per isolate and database URL; if
// anything is missing it answers 503 `schema_out_of_date` and logs the
// missing migrations, instead of serving a half-working API.
//
// One statement (works on the Neon HTTP driver), catalog lookups only.
// ---------------------------------------------------------------------------

/** Migration tag → SQL boolean that is true once its objects exist. */
const CHECKS: [string, string][] = [
  ['0004_email_otp_codes_index', `to_regclass('email_otp_codes_user_id_expires_at_idx') IS NOT NULL`],
  ['0005_users_email_unique', `to_regclass('users_email_unique_idx') IS NOT NULL`],
  [
    '0006_lat_lng_range_checks',
    `(SELECT count(*) FROM pg_constraint WHERE conname IN
      ('activities_lat_lng_range', 'destinations_lat_lng_range', 'hotels_lat_lng_range')) = 3`,
  ],
  ['0007_hotels_one_per_destination', `to_regclass('hotels_destination_id_idx') IS NOT NULL`],
  [
    '0008_date_coherence',
    `(SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
      ('trips_biz07_date_coherence', 'destinations_biz07_date_coherence', 'days_biz07_date_coherence')) = 3`,
  ],
  ['0009_otp_issue_atomic', `to_regprocedure('otp_issue(integer,text,integer,integer,integer)') IS NOT NULL`],
  [
    '0010_reconcile_push_built_schema',
    `EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trips'
      AND column_name = 'public_slug' AND column_default IS NOT NULL)`,
  ],
];

/** Tags of the required migrations whose objects are missing (empty = ready). */
export async function missingMigrations(db: Db): Promise<string[]> {
  const select = CHECKS.map(([tag, cond]) => `SELECT '${tag}'::text AS tag WHERE NOT (${cond})`).join(' UNION ALL ');
  const { rows } = await db.execute<{ tag: string }>(sql.raw(`${select} ORDER BY 1`));
  return rows.map((r) => r.tag);
}

/** How long a "missing" result is trusted before re-checking (lets `db:migrate` heal a live Worker). */
export const MISSING_RECHECK_MS = 30_000;

type CacheEntry = { ok: true } | { ok: false; missing: string[]; checkedAt: number };
const cache = new Map<string, CacheEntry>();

/**
 * Missing migrations for `databaseUrl`, checked at most once per isolate while
 * ready, and at most every MISSING_RECHECK_MS while not. Throws if the check
 * itself fails (DB unreachable): nothing is cached then, so the caller can let
 * the request proceed and fail on its own.
 */
export async function schemaStatus(databaseUrl: string, db: Db, now = Date.now()): Promise<string[]> {
  const hit = cache.get(databaseUrl);
  if (hit?.ok) return [];
  if (hit && now - hit.checkedAt < MISSING_RECHECK_MS) return hit.missing;
  const missing = await missingMigrations(db);
  if (missing.length === 0) {
    cache.set(databaseUrl, { ok: true });
  } else {
    cache.set(databaseUrl, { ok: false, missing, checkedAt: now });
    console.error(
      `Database schema is behind this Worker: missing ${missing.join(', ')}. ` +
        `Run \`npm run db:migrate\` (backend/) against this DATABASE_URL; ` +
        `requests answer 503 schema_out_of_date until then.`,
    );
  }
  return missing;
}

/** Test hook: forget every cached result. */
export function _resetSchemaCheckForTests(): void {
  cache.clear();
}
