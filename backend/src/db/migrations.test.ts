import { describe, it, expect, afterEach } from 'vitest';
import { journalTags, scratchDbAt, type ScratchDb } from '../test-utils/migrations';
import { pgErrorCode } from './pg-errors';

// Migrations "up" on databases that already hold data (the production case),
// using the real Drizzle migrator. Each test gets its own scratch database.

let db: ScratchDb | undefined;
afterEach(async () => {
  await db?.drop();
  db = undefined;
});

async function q(sql: string, params: unknown[] = []) {
  return (await db!.pool.query(sql, params)).rows;
}

async function seedUser(email: string, kc = email) {
  const [row] = await q(
    `INSERT INTO users (keycloak_id, email, name) VALUES ($1, $2, 'n') RETURNING id`,
    [kc, email],
  );
  return row.id as number;
}

describe('migration journal', () => {
  it('lists every SQL migration in order', () => {
    const tags = journalTags();
    expect(tags.slice(0, 7)).toEqual([
      '0000_initial',
      '0001_add_hotel_url_activity_time',
      '0002_add_public_slug',
      '0003_add_email_otp_codes',
      '0004_email_otp_codes_index',
      '0005_users_email_unique',
      '0006_lat_lng_range_checks',
    ]);
  });

  it('re-running the migrator on an up-to-date database is a no-op', async () => {
    db = await scratchDbAt(journalTags().at(-1)!);
    const before = await q('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
    await db.migrateToLatest();
    expect(await q('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).toEqual(before);
  });
});

describe('0004 email_otp_codes index (DATA-01)', () => {
  it('applies on a populated table and keeps every row', async () => {
    db = await scratchDbAt('0003_add_email_otp_codes');
    const u = await seedUser('a@example.com');
    await q(
      `INSERT INTO email_otp_codes (user_id, code_hash, expires_at, used_at)
       SELECT $1, 'h' || g, now() - (g || ' minutes')::interval, CASE WHEN g % 2 = 0 THEN now() END
       FROM generate_series(1, 500) g`,
      [u],
    );

    await db.migrateToLatest();

    expect(await q('SELECT count(*)::int AS n FROM email_otp_codes')).toEqual([{ n: 500 }]);
    const idx = await q(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'email_otp_codes_user_id_expires_at_idx'`,
    );
    expect(idx).toHaveLength(1);
  });
});

describe('0005 users.email unique (DATA-02)', () => {
  it('applies when emails are distinct, and tolerates many empty emails', async () => {
    db = await scratchDbAt('0004_email_otp_codes_index');
    await seedUser('a@example.com');
    await seedUser('b@example.com');
    await seedUser('', 'kc-empty-1');
    await seedUser('', 'kc-empty-2');

    await db.migrateToLatest();

    expect(await q(`SELECT 1 FROM pg_indexes WHERE indexname = 'users_email_unique_idx'`)).toHaveLength(1);
    expect(await q('SELECT count(*)::int AS n FROM users')).toEqual([{ n: 4 }]);
  });

  it.each([
    ['exact duplicates', 'dup@example.com', 'dup@example.com'],
    ['case-only duplicates', 'Dup@Example.com', 'dup@example.com'],
  ])('refuses to apply over %s, naming the key, and rolls back the whole run', async (_l, e1, e2) => {
    db = await scratchDbAt('0003_add_email_otp_codes');
    const keep = await seedUser(e1, 'kc-1');
    await seedUser(e2, 'kc-2');

    await expect(db.migrateToLatest()).rejects.toThrow();
    // Nothing from this run survived — not even 0004, applied in the same transaction.
    expect(await q(`SELECT indexname FROM pg_indexes WHERE indexname IN ('users_email_unique_idx', 'email_otp_codes_user_id_expires_at_idx')`)).toEqual([]);
    expect(await q('SELECT count(*)::int AS n FROM users')).toEqual([{ n: 2 }]);

    // Documented remedy: resolve the duplicate by hand, then re-run.
    await q(`DELETE FROM users WHERE id <> $1`, [keep]);
    await db.migrateToLatest();
    expect(await q(`SELECT 1 FROM pg_indexes WHERE indexname = 'users_email_unique_idx'`)).toHaveLength(1);
  });

  it('reports the offending key in the error', async () => {
    db = await scratchDbAt('0004_email_otp_codes_index');
    await seedUser('dup@example.com', 'kc-1');
    await seedUser('dup@example.com', 'kc-2');
    const err = (await db.migrateToLatest().then(() => null, (e: unknown) => e)) as Error;
    expect(pgErrorCode(err)).toBe('23505');
    const pgErr = (err.cause ?? err) as { detail?: string; message: string };
    expect(pgErr.message).toContain('users_email_unique_idx');
    expect(pgErr.detail).toContain('dup@example.com');
  });
});

describe('0006 lat/lng CHECK constraints (DATA-03)', () => {
  // [label, lat, lng, expected lat, expected lng] after migrating
  const CASES: [string, string | null, string | null, string | null, string | null][] = [
    ['valid', '35.6812362', '139.7671248', '35.6812362', '139.7671248'],
    ['boundaries', '-90', '180', '-90.0000000', '180.0000000'],
    ['both null', null, null, null, null],
    ['only lat', '45', null, '45.0000000', null],
    ['lat out of range', '95', '10', null, null],
    ['lng out of range', '10', '-200', null, null],
    ['swapped (lng in lat)', '139.7671248', '35.6812362', null, null],
    ['NaN lat', 'NaN', '10', null, null],
    ['null lat, bad lng', null, '500', null, null],
  ];

  it.each(['destinations', 'hotels', 'activities'])(
    '%s: clears both coordinates of out-of-range/NaN rows, keeps every other row as-is',
    async (table) => {
      db = await scratchDbAt('0005_users_email_unique');
      const u = await seedUser('a@example.com');
      const [trip] = await q(`INSERT INTO trips (user_id, name) VALUES ($1, 't') RETURNING id`, [u]);
      const [dest] = await q(`INSERT INTO destinations (trip_id, city_name, country) VALUES ($1, 'c', 'j') RETURNING id`, [trip.id]);
      const [day] = await q(`INSERT INTO days (destination_id, date) VALUES ($1, '2026-03-01') RETURNING id`, [dest.id]);

      const ids: number[] = [];
      for (const [label, lat, lng] of CASES) {
        const [row] =
          table === 'destinations'
            ? await q(`INSERT INTO destinations (trip_id, city_name, country, lat, lng) VALUES ($1, $2, 'j', $3, $4) RETURNING id`, [trip.id, label, lat, lng])
            : table === 'hotels'
              ? await q(`INSERT INTO hotels (destination_id, name, lat, lng) VALUES ($1, $2, $3, $4) RETURNING id`, [dest.id, label, lat, lng])
              : await q(`INSERT INTO activities (day_id, name, lat, lng) VALUES ($1, $2, $3, $4) RETURNING id`, [day.id, label, lat, lng]);
        ids.push(row.id);
      }
      const countBefore = await q(`SELECT count(*)::int AS n FROM ${table}`);

      await db.migrateToLatest();

      expect(await q(`SELECT count(*)::int AS n FROM ${table}`)).toEqual(countBefore);
      for (const [i, [label, , , lat, lng]] of CASES.entries()) {
        const [row] = await q(`SELECT lat, lng FROM ${table} WHERE id = $1`, [ids[i]]);
        expect({ label, lat: row.lat, lng: row.lng }).toEqual({ label, lat, lng });
      }
      const [con] = await q(
        `SELECT convalidated FROM pg_constraint WHERE conname = $1`,
        [`${table}_lat_lng_range`],
      );
      expect(con).toEqual({ convalidated: true });
    },
  );
});
