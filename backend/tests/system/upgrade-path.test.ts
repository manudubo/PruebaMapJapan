/**
 * System: the 0003 → 0009 upgrade path, on data shaped like production.
 *
 * Production was built before the Drizzle journal existed (it was added in
 * Phase 24), so its database most likely has the 0000–0003 objects but NO
 * drizzle.__drizzle_migrations rows. Both shapes are tested:
 *   - "hand": SQL files 0000–0003 applied by hand, no journal table. The
 *     migrator then re-runs 0000–0003 (all IF NOT EXISTS → no-ops) and 0004+.
 *   - "migrator": 0000–0003 applied by the Drizzle migrator.
 *
 * The legacy data is deliberately ugly: case-variant duplicate emails, empty
 * emails, out-of-range / NaN / swapped coordinates, several hotels per
 * destination, reversed date ranges, destinations outside their trip and
 * overlapping, days outside their destination, and expired / used / burned /
 * pending OTP codes. Expected behaviour is exactly what 24-BACKEND-SUMMARY and
 * 25-BIZ07-SEC22-OTP-SUMMARY document.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BIZ07_VIOLATIONS_SQL,
  MIGRATIONS_FOLDER,
  client,
  createSigner,
  emptyScratch,
  handAppliedScratch,
  installFakeNetwork,
  installNeonHttpFake,
  journal,
  makeEnv,
  makeUser,
  migratorScratch,
  schemaFingerprint,
  type NeonFake,
  type Scratch,
  type Signer,
} from './harness';

const TABLES = ['users', 'trips', 'destinations', 'hotels', 'days', 'activities', 'email_otp_codes'];

async function snapshot(db: Scratch): Promise<string> {
  const parts: unknown[] = [];
  for (const t of TABLES) parts.push(await db.q(`SELECT * FROM ${t} ORDER BY id`));
  return JSON.stringify(parts);
}

interface Legacy {
  alice: number;
  dupOld: number;
  dupNew: number;
  empty1: number;
  empty2: number;
  t1: number;
  t2: number;
  slug: string;
  d1: number;
  d2: number;
  d3: number;
  hotelsD1: number[];
  hotelD2: number;
  dayOutside: number;
  actSwapped: number;
  actValid: number;
}

/** Ugly production-like data at schema 0003, via raw SQL only. */
async function seedLegacy(db: Scratch): Promise<Legacy> {
  const user = async (kc: string, email: string) =>
    (await db.q<{ id: number }>(`INSERT INTO users (keycloak_id, email, name) VALUES ($1, $2, $1) RETURNING id`, [kc, email]))[0]!.id;
  const alice = await user('kc-alice', 'alice@example.test');
  const dupOld = await user('kc-dup-old', 'Dup@Example.test');
  const dupNew = await user('kc-dup-new', 'dup@example.test');
  const empty1 = await user('kc-empty-1', '');
  const empty2 = await user('kc-empty-2', '');

  const [t1] = await db.q<{ id: number; public_slug: string }>(
    `INSERT INTO trips (user_id, name, start_date, end_date, is_public)
     VALUES ($1, 'Japan', '2026-03-01', '2026-03-10', true) RETURNING id, public_slug`,
    [alice],
  );
  const [t2] = await db.q<{ id: number }>(
    `INSERT INTO trips (user_id, name, start_date, end_date) VALUES ($1, 'Reversed', '2026-05-10', '2026-05-01') RETURNING id`,
    [alice],
  );
  const dest = async (city: string, s: string | null, e: string | null, lat: string | null, lng: string | null) =>
    (await db.q<{ id: number }>(
      `INSERT INTO destinations (trip_id, city_name, country, start_date, end_date, lat, lng)
       VALUES ($1, $2, 'Japan', $3, $4, $5, $6) RETURNING id`,
      [t1!.id, city, s, e, lat, lng],
    ))[0]!.id;
  const d1 = await dest('Outside', '2026-02-20', '2026-03-03', '95', '10'); // outside trip, bad lat
  const d2 = await dest('Overlap', '2026-03-02', '2026-03-06', 'NaN', '135'); // overlaps d1, NaN
  const d3 = await dest('Reversed', '2026-03-09', '2026-03-07', '35.0', '139.0'); // reversed, valid coords

  const hotel = async (d: number, name: string, lat: string | null, lng: string | null) =>
    (await db.q<{ id: number }>(
      `INSERT INTO hotels (destination_id, name, lat, lng) VALUES ($1, $2, $3, $4) RETURNING id`,
      [d, name, lat, lng],
    ))[0]!.id;
  const hotelsD1 = [await hotel(d1, 'old', null, null), await hotel(d1, 'mid', '1', '1'), await hotel(d1, 'newest', '35.1', '135.1')];
  const hotelD2 = await hotel(d2, 'only', '10', '-200');

  const [dayOutside] = await db.q<{ id: number }>(`INSERT INTO days (destination_id, date) VALUES ($1, '1999-01-01') RETURNING id`, [d1]);
  const [dayIn] = await db.q<{ id: number }>(`INSERT INTO days (destination_id, date) VALUES ($1, '2026-03-04') RETURNING id`, [d2]);
  const [actSwapped] = await db.q<{ id: number }>(
    `INSERT INTO activities (day_id, name, lat, lng) VALUES ($1, 'swapped', '139.7', '35.6') RETURNING id`,
    [dayIn!.id],
  );
  const [actValid] = await db.q<{ id: number }>(
    `INSERT INTO activities (day_id, name, lat, lng, order_index) VALUES ($1, 'valid', '35.6', '139.7', 1) RETURNING id`,
    [dayIn!.id],
  );

  // OTPs. alice: 5 codes in the last hour, all used/expired → at the cap.
  for (const mins of [10, 20, 30, 40, 50]) {
    await db.q(
      `INSERT INTO email_otp_codes (user_id, code_hash, created_at, expires_at, used_at, attempts)
       VALUES ($1, 'h', now() - make_interval(mins => $2), now() - make_interval(mins => $2 - 10), CASE WHEN $2 % 20 = 0 THEN now() END, CASE WHEN $2 = 30 THEN 5 ELSE 0 END)`,
      [alice, mins],
    );
  }
  // empty1: a live pending code. empty2: only a 2-hour-old expired one.
  await db.q(
    `INSERT INTO email_otp_codes (user_id, code_hash, created_at, expires_at) VALUES ($1, 'h', now() - interval '5 minutes', now() + interval '5 minutes')`,
    [empty1],
  );
  await db.q(
    `INSERT INTO email_otp_codes (user_id, code_hash, created_at, expires_at) VALUES ($1, 'h', now() - interval '2 hours', now() - interval '110 minutes')`,
    [empty2],
  );

  return {
    alice, dupOld, dupNew, empty1, empty2,
    t1: t1!.id, t2: t2!.id, slug: t1!.public_slug,
    d1, d2, d3, hotelsD1, hotelD2,
    dayOutside: dayOutside!.id, actSwapped: actSwapped!.id, actValid: actValid!.id,
  };
}

/** The duplicate-email pre-check published in 24-BACKEND-SUMMARY. */
const DUP_PRECHECK = `SELECT lower(email) AS email, array_agg(id ORDER BY id) AS ids FROM users WHERE email <> '' GROUP BY 1 HAVING count(*) > 1`;

let fresh: Scratch;
let freshPrint: Awaited<ReturnType<typeof schemaFingerprint>>;
let signer: Signer;
let neon: NeonFake;

beforeAll(async () => {
  signer = await createSigner();
  installFakeNetwork([signer]);
  neon = installNeonHttpFake();
  fresh = await migratorScratch(journal().entries.at(-1)!.tag, 'fresh');
  freshPrint = await schemaFingerprint(fresh);
}, 60_000);

afterAll(async () => {
  await neon.close();
  await fresh.drop();
});

describe('migration journal consistency', () => {
  const j = journal();
  it('idx is 0..n-1 and tags match the SQL files on disk one to one, in order', () => {
    expect(j.entries.map((e) => e.idx)).toEqual(j.entries.map((_, i) => i));
    const files = fs.readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith('.sql')).sort();
    expect(j.entries.map((e) => `${e.tag}.sql`)).toEqual(files);
    for (const [i, e] of j.entries.entries()) expect(e.tag.startsWith(String(i).padStart(4, '0') + '_')).toBe(true);
  });

  it('`when` is strictly increasing (the migrator skips any entry older than the last applied one)', () => {
    for (let i = 1; i < j.entries.length; i++) {
      expect(j.entries[i]!.when, j.entries[i]!.tag).toBeGreaterThan(j.entries[i - 1]!.when);
    }
  });

  it('0000–0003 are re-runnable (IF NOT EXISTS) — required because production has no journal rows for them', () => {
    for (const tag of j.entries.slice(0, 4).map((e) => e.tag)) {
      const text = fs.readFileSync(`${MIGRATIONS_FOLDER}/${tag}.sql`, 'utf8');
      const creates = text.match(/\b(CREATE (UNIQUE )?INDEX|CREATE TABLE|ADD COLUMN)\b(?! IF NOT EXISTS)/g) ?? [];
      expect(creates, tag).toEqual([]);
    }
  });
});

describe.each(['hand', 'migrator'] as const)('upgrade 0003 → 0009 with ugly legacy data (%s-built 0003)', (shape) => {
  let db: Scratch;
  let legacy: Legacy;

  beforeAll(async () => {
    db =
      shape === 'hand'
        ? await handAppliedScratch('0003_add_email_otp_codes', 'uphand')
        : await migratorScratch('0003_add_email_otp_codes', 'upmig');
    legacy = await seedLegacy(db);
  }, 60_000);

  afterAll(async () => {
    await db.drop();
  });

  it('first run aborts on 0005, names the duplicate email, and rolls back the WHOLE run (0004 too, no data change)', async () => {
    const before = await snapshot(db);
    const err = (await db.migrateToLatest().then(() => null, (e: unknown) => e)) as Error & { cause?: unknown };
    expect(err).not.toBeNull();
    const pgErr = (err.cause ?? err) as { code?: string; message: string; detail?: string };
    expect(pgErr.code).toBe('23505');
    expect(pgErr.message).toContain('users_email_unique_idx');
    expect(pgErr.detail).toContain('dup@example.test');

    expect(await snapshot(db)).toBe(before);
    expect(await db.q(`SELECT indexname FROM pg_indexes WHERE indexname IN ('email_otp_codes_user_id_expires_at_idx', 'users_email_unique_idx')`)).toEqual([]);
    expect(await db.q(`SELECT 1 FROM pg_proc WHERE proname = 'otp_issue'`)).toEqual([]);
    const applied = await db.q<{ n: number }>(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    expect(applied[0]!.n).toBe(shape === 'hand' ? 0 : 4);
  });

  it('the documented pre-check finds exactly the case-variant pair (empty emails are not duplicates)', async () => {
    expect(await db.q(DUP_PRECHECK)).toEqual([{ email: 'dup@example.test', ids: [legacy.dupOld, legacy.dupNew] }]);
  });

  it('after the non-destructive remedy (blank the newer duplicate’s email) the run completes', async () => {
    // Deleting a duplicate would cascade its trips; blanking keeps them. The
    // account still signs in by keycloak_id (see the app test below).
    await db.q(`UPDATE users SET email = '' WHERE id = $1`, [legacy.dupNew]);
    await db.migrateToLatest();
    const applied = await db.q<{ n: number }>(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    expect(applied[0]!.n).toBe(journal().entries.length);
  });

  it('0006 cleared BOTH coordinates of out-of-range / NaN / swapped rows and kept valid ones', async () => {
    const coords = async (t: string, id: number) => (await db.q(`SELECT lat, lng FROM ${t} WHERE id = $1`, [id]))[0];
    expect(await coords('destinations', legacy.d1)).toEqual({ lat: null, lng: null });
    expect(await coords('destinations', legacy.d2)).toEqual({ lat: null, lng: null });
    expect(await coords('destinations', legacy.d3)).toEqual({ lat: '35.0000000', lng: '139.0000000' });
    expect(await coords('hotels', legacy.hotelD2)).toEqual({ lat: null, lng: null });
    expect(await coords('activities', legacy.actSwapped)).toEqual({ lat: null, lng: null });
    expect(await coords('activities', legacy.actValid)).toEqual({ lat: '35.6000000', lng: '139.7000000' });
  });

  it('0007 kept only the newest hotel of the destination', async () => {
    expect(await db.q(`SELECT id, name FROM hotels WHERE destination_id = $1`, [legacy.d1])).toEqual([
      { id: legacy.hotelsD1[2], name: 'newest' },
    ]);
    expect(await db.q(`SELECT count(*)::int AS n FROM hotels`)).toEqual([{ n: 2 }]);
  });

  it('0008 did not retro-validate: every incoherent legacy row is still there', async () => {
    const rules = (await db.q<{ rule: string }>(BIZ07_VIOLATIONS_SQL)).map((r) => r.rule).sort();
    expect(rules).toEqual(['day-outside-dest', 'dest-outside-trip', 'dest-reversed', 'overlap', 'trip-reversed']);
    expect(await db.q(`SELECT count(*)::int AS n FROM days`)).toEqual([{ n: 2 }]);
  });

  it('nothing else was lost: users, trips, days, activities, OTP rows unchanged in number', async () => {
    const counts = await db.q(`SELECT
      (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM trips) AS trips,
      (SELECT count(*)::int FROM destinations) AS destinations, (SELECT count(*)::int FROM activities) AS activities,
      (SELECT count(*)::int FROM email_otp_codes) AS otps`);
    expect(counts).toEqual([{ users: 5, trips: 2, destinations: 3, activities: 2, otps: 7 }]);
  });

  it('re-running the migrator is a no-op (journal, data and schema unchanged)', async () => {
    const before = await snapshot(db);
    const print = await schemaFingerprint(db);
    await db.migrateToLatest();
    expect(await snapshot(db)).toBe(before);
    expect(await schemaFingerprint(db)).toEqual(print);
    const applied = await db.q<{ n: number }>(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    expect(applied[0]!.n).toBe(journal().entries.length);
  });

  it('the upgraded schema is identical to a freshly migrated database (catalog fingerprint)', async () => {
    expect(await schemaFingerprint(db)).toEqual(freshPrint);
  });

  it('pg_dump --schema-only of the upgraded and the fresh database are identical', () => {
    const bin = pgDumpBinary();
    const dump = (url: string) =>
      execFileSync(bin, ['--schema-only', '--no-owner', '--no-privileges', '--schema=public', url], { encoding: 'utf8' })
        .split('\n')
        .filter((l) => !l.startsWith('--') && !/^\\(un)?restrict /.test(l))
        .join('\n');
    expect(dump(db.url)).toBe(dump(fresh.url));
  });

  describe('the app works on the upgraded database (production driver: neon-http)', () => {
    const req = () => client(makeEnv(db.url, { DB_DRIVER: 'neon', ENVIRONMENT: 'development' }));
    const as = (sub: string, email: string) => makeUser(signer, { sub, email });

    it('legacy owner reads trips, full nested trip and the public page', async () => {
      const alice = await as('kc-alice', 'alice@example.test');
      const list = await req()('GET', '/api/trips', { token: alice.token });
      expect(list.status, list.text).toBe(200);
      expect(list.body.data).toHaveLength(2);
      const trip = await req()('GET', `/api/trips/${legacy.t1}`, { token: alice.token });
      expect(trip.status, trip.text).toBe(200);
      const pub = await req()('GET', `/api/public/trips/${legacy.slug}`);
      expect(pub.status, pub.text).toBe(200);
    });

    it('legacy incoherent rows: non-date edits work; a form that re-sends the stored dates is refused with 422', async () => {
      const alice = await as('kc-alice', 'alice@example.test');
      const base = `/api/trips/${legacy.t1}/destinations/${legacy.d1}`;
      const rename = await req()('PATCH', base, { token: alice.token, body: { city_name: 'Renamed' } });
      expect(rename.status, rename.text).toBe(200);
      const renameTrip = await req()('PATCH', `/api/trips/${legacy.t2}`, { token: alice.token, body: { name: 'still reversed' } });
      expect(renameTrip.status, renameTrip.text).toBe(200);
      // The trip-edit destination form always sends start_date/end_date, so
      // the trigger fires even though they are unchanged (documented finding).
      const resend = await req()('PATCH', base, {
        token: alice.token,
        body: { city_name: 'Renamed', start_date: '2026-02-20', end_date: '2026-03-03' },
      });
      expect(resend.status).toBe(422);
      expect(resend.body.code).toBe('date_conflict');
    });

    it('new writes on legacy data are validated; hotel PUT updates the kept hotel row', async () => {
      const alice = await as('kc-alice', 'alice@example.test');
      const d2 = `/api/trips/${legacy.t1}/destinations/${legacy.d2}`;
      expect((await req()('POST', `${d2}/days`, { token: alice.token, body: { date: '2026-03-05' } })).status).toBe(201);
      expect((await req()('POST', `${d2}/days`, { token: alice.token, body: { date: '2026-03-07' } })).status).toBe(422);
      const hotel = await req()('PUT', `/api/trips/${legacy.t1}/destinations/${legacy.d1}/hotel`, {
        token: alice.token,
        body: { name: 'Replaced' },
      });
      expect(hotel.status, hotel.text).toBe(200);
      expect(hotel.body.data.id).toBe(legacy.hotelsD1[2]);
    });

    it('the blanked duplicate still signs in (200, not 409) and keeps the empty email', async () => {
      const dup = await as('kc-dup-new', 'dup@example.test');
      const me = await req()('GET', '/api/users/me', { token: dup.token });
      expect(me.status, me.text).toBe(200);
      expect((await db.q(`SELECT email FROM users WHERE id = $1`, [legacy.dupNew]))[0]).toEqual({ email: '' });
      const old = await as('kc-dup-old', 'DUP@example.test');
      expect((await req()('GET', '/api/users/me', { token: old.token })).status).toBe(200);
    });

    it('otp_issue honours legacy OTP rows: pending code, hourly cap, and stale cleanup', async () => {
      const e1 = await as('kc-empty-1', 'empty1@example.test');
      const pending = await req()('POST', '/api/auth/otp-request', { token: e1.token });
      expect(pending.status, pending.text).toBe(429);
      expect(pending.body.error).toBe('otp_pending');
      expect(pending.body.retryAfter).toBeGreaterThan(200);

      const alice = await as('kc-alice', 'alice@example.test');
      const capped = await req()('POST', '/api/auth/otp-request', { token: alice.token });
      expect(capped.status, capped.text).toBe(429);
      expect(capped.body.error).toBe('otp_rate_limited');
      expect(capped.body.retryAfter).toBeGreaterThan(500);
      expect(capped.body.retryAfter).toBeLessThanOrEqual(600);

      const e2 = await as('kc-empty-2', 'empty2@example.test');
      const issued = await req()('POST', '/api/auth/otp-request', { token: e2.token });
      expect(issued.status, issued.text).toBe(201);
      // The 2-hour-old code was purged by the DATA-01 cleanup; the new one is live.
      expect(await db.q(`SELECT count(*)::int AS n FROM email_otp_codes WHERE user_id = $1`, [legacy.empty2])).toEqual([{ n: 1 }]);
    });
  });
});

describe('upgrade from a push-built 0003 database (SETUP.md `drizzle-kit push --force`)', () => {
  // Pre-Phase-24 docs created databases with `drizzle-kit push`, which builds
  // tables from schema.ts, not from the SQL files: no DB default on
  // trips.public_slug (rows that existed when the column was added stayed
  // NULL), nullable users.preferences, Drizzle-style FK names, no FK indexes.
  let db: Scratch;
  let tripId: number;

  beforeAll(async () => {
    db = await emptyScratch('push');
    await db.q(fs.readFileSync(new URL('./fixtures/push-0003-schema.sql', import.meta.url), 'utf8'));
    const [u] = await db.q<{ id: number }>(
      `INSERT INTO users (keycloak_id, email, name, preferences) VALUES ('kc-push', 'push@example.test', 'kc-push', NULL) RETURNING id`,
    );
    const [t] = await db.q<{ id: number }>(`INSERT INTO trips (user_id, name) VALUES ($1, 'pre-slug trip') RETURNING id`, [u!.id]);
    tripId = t!.id;
    expect(await db.q(`SELECT public_slug FROM trips`)).toEqual([{ public_slug: null }]);
    await db.migrateToLatest();
  }, 60_000);

  afterAll(async () => {
    await db.drop();
  });

  it('ends with the same catalog schema as a fresh database', async () => {
    expect(await schemaFingerprint(db)).toEqual(freshPrint);
  });

  it('a pre-slug trip can be shared: it has a slug and the public page answers', async () => {
    const owner = await makeUser(signer, { sub: 'kc-push', email: 'push@example.test' });
    const req = client(makeEnv(db.url, { DB_DRIVER: 'neon', ENVIRONMENT: 'development' }));
    const share = await req('PATCH', `/api/trips/${tripId}`, { token: owner.token, body: { is_public: true } });
    expect(share.status, share.text).toBe(200);
    expect(share.body.data.public_slug).toMatch(/^[0-9a-f-]{36}$/);
    expect((await req('GET', `/api/public/trips/${share.body.data.public_slug}`)).status).toBe(200);
  });

  it('a user with NULL preferences reads {} from /api/users/me', async () => {
    const owner = await makeUser(signer, { sub: 'kc-push', email: 'push@example.test' });
    const req = client(makeEnv(db.url, { DB_DRIVER: 'neon', ENVIRONMENT: 'development' }));
    const me = await req('GET', '/api/users/me', { token: owner.token });
    expect(me.status).toBe(200);
    expect(me.body.data.preferences).toEqual({});
  });
});

describe('upgrade from 0003 with clean data', () => {
  it('applies 0004–0009 in one run and matches the fresh schema', async () => {
    const db = await handAppliedScratch('0003_add_email_otp_codes', 'upclean');
    try {
      await db.q(`INSERT INTO users (keycloak_id, email, name) VALUES ('a', 'a@x.test', 'a'), ('b', '', 'b'), ('c', '', 'c')`);
      await db.migrateToLatest();
      expect(await schemaFingerprint(db)).toEqual(freshPrint);
    } finally {
      await db.drop();
    }
  });

  it('an empty database migrates to the same schema as the harness database', async () => {
    const db = await emptyScratch('upempty');
    try {
      await db.migrateToLatest();
      expect(await schemaFingerprint(db)).toEqual(freshPrint);
    } finally {
      await db.drop();
    }
  });
});

/** pg_dump of the server's major version (the CI and local servers are 16). */
function pgDumpBinary(): string {
  const candidates = [process.env['PG_DUMP'], '/usr/lib/postgresql/16/bin/pg_dump', 'pg_dump'].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const v = execFileSync(c, ['--version'], { encoding: 'utf8' });
      if (/\b16\./.test(v)) return c;
    } catch {
      /* try the next one */
    }
  }
  throw new Error('pg_dump 16 not found: set PG_DUMP to a pg_dump binary matching the server major version');
}
