import { sql } from 'drizzle-orm';
import type { Db } from '.';

/**
 * Schema guard (review M1). Code in this Worker depends on database objects
 * that only `db:migrate` creates — `drizzle-kit push` never creates functions
 * or triggers, and a Worker deployed before its migrations would otherwise
 * fail with a 500 deep inside a query (`function otp_issue does not exist`,
 * 42P10 on the hotel upsert) or, worse, silently skip the BIZ-07 date rules.
 *
 * The check is one catalog query, run on the first DB request of an isolate
 * and cached: a ready schema is never checked again; a missing one is
 * re-checked at most every SCHEMA_RECHECK_MS so the Worker recovers on its
 * own once migrations are applied.
 */

/** Human-readable names, in the order they are reported (= migration order). */
export const REQUIRED_SCHEMA_OBJECTS = [
  'hotels_destination_id_idx (unique)', // 0007 — ON CONFLICT (destination_id) target
  'trigger trips_biz07_date_coherence', // 0008
  'trigger destinations_biz07_date_coherence', // 0008
  'trigger days_biz07_date_coherence', // 0008
  'function otp_issue()', // 0009 — called with 5 integer/text args
] as const;

/** Stable error code for clients and logs. */
export const SCHEMA_NOT_MIGRATED = 'schema_not_migrated';

export const SCHEMA_RECHECK_MS = 30_000;

interface CatalogRow extends Record<string, unknown> {
  hotels_unique: boolean;
  trips_trigger: boolean;
  destinations_trigger: boolean;
  days_trigger: boolean;
  otp_issue: boolean;
}

/** One round-trip; returns the names of required objects that are absent. */
export async function findMissingSchemaObjects(db: Db): Promise<string[]> {
  const trigger = (table: string, name: string) =>
    sql`EXISTS (SELECT 1 FROM pg_trigger t
                 WHERE NOT t.tgisinternal
                   AND t.tgname = ${name}
                   AND t.tgrelid = to_regclass(${table}))`;
  const { rows } = await db.execute<CatalogRow>(sql`
    SELECT
      EXISTS (SELECT 1 FROM pg_index i
               WHERE i.indexrelid = to_regclass('hotels_destination_id_idx')
                 AND i.indrelid = to_regclass('hotels')
                 AND i.indisunique) AS hotels_unique,
      ${trigger('trips', 'trips_biz07_date_coherence')} AS trips_trigger,
      ${trigger('destinations', 'destinations_biz07_date_coherence')} AS destinations_trigger,
      ${trigger('days', 'days_biz07_date_coherence')} AS days_trigger,
      to_regprocedure('otp_issue(integer, text, integer, integer, integer)') IS NOT NULL AS otp_issue`);
  const row = rows[0];
  if (!row) throw new Error('schema guard: catalog query returned no row');
  const present = [
    row.hotels_unique,
    row.trips_trigger,
    row.destinations_trigger,
    row.days_trigger,
    row.otp_issue,
  ];
  return REQUIRED_SCHEMA_OBJECTS.filter((_, i) => present[i] !== true);
}

export type SchemaVerdict =
  | { ok: true; unverified?: true }
  | { ok: false; missing: string[] };

type CacheEntry = { ok: true } | { ok: false; missing: string[]; checkedAt: number };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<SchemaVerdict>>();

/** Test hook: forget every cached verdict. */
export function resetSchemaGuardCache(): void {
  cache.clear();
  inflight.clear();
}

/**
 * Cached readiness for the database identified by `key` (its URL; never
 * logged). A check that itself fails (DB unreachable) is not cached and does
 * not block the request: the request then fails or succeeds on its own, and
 * the next one re-checks.
 */
export async function checkSchemaReady(db: Db, key: string): Promise<SchemaVerdict> {
  const hit = cache.get(key);
  if (hit?.ok) return { ok: true };
  if (hit && Date.now() - hit.checkedAt < SCHEMA_RECHECK_MS) {
    return { ok: false, missing: hit.missing };
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = runCheck(db, key).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

async function runCheck(db: Db, key: string): Promise<SchemaVerdict> {
  let missing: string[];
  try {
    missing = await findMissingSchemaObjects(db);
  } catch (err) {
    console.warn('schema guard: readiness check failed, not cached:', (err as Error).message);
    return { ok: true, unverified: true };
  }
  if (missing.length === 0) {
    cache.set(key, { ok: true });
    return { ok: true };
  }
  cache.set(key, { ok: false, missing, checkedAt: Date.now() });
  console.error(
    `schema guard: ${SCHEMA_NOT_MIGRATED} — missing ${missing.join(', ')}. ` +
      'Run `npm run db:migrate --workspace=backend` against this database.',
  );
  return { ok: false, missing };
}
