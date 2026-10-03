/**
 * Adversarial: concurrent requests against a real multi-connection Postgres
 * (every app request opens its own pg.Pool in local mode, so these really
 * interleave on separate connections).
 */
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  buildTree,
  client,
  createSigner,
  createTestDatabase,
  describeDb,
  dropTestDatabase,
  installFakeNetwork,
  makeEnv,
  makeUser,
  sql,
  waitForLockWaiters,
  type Req,
  type Signer,
  type TestUser,
} from './harness';

let dbUrl: string;
let req: Req;
let signer: Signer;
let user: TestUser;

describeDb('concurrency', () => {
  beforeAll(async () => {
    signer = await createSigner();
    installFakeNetwork([signer]);
    dbUrl = await createTestDatabase('concurrency');
    req = client(makeEnv(dbUrl));
    user = await makeUser(signer);
  }, 60_000);

  afterAll(async () => {
    await dropTestDatabase(dbUrl);
  });

  it('BUG-03 regression: 25 simultaneous first requests from a brand-new user → all 2xx, exactly one user row', async () => {
    const fresh = await makeUser(signer);
    const paths = ['/api/trips', '/api/users/me', '/api/users/me/trips'];
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => req('GET', paths[i % 3]!, { token: fresh.token })),
    );
    for (const r of results) expect(r.status, r.text).toBeLessThan(300);
    const rows = await sql(dbUrl, 'select id from users where keycloak_id=$1', [fresh.sub]);
    expect(rows).toHaveLength(1);
    const meCreated = results.filter((r, i) => i % 3 === 1 && r.status === 201);
    expect(meCreated.length).toBeLessThanOrEqual(1);
  });

  it('30 concurrent trip creates → 30 distinct trips, 30 distinct slugs', async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => req('POST', '/api/trips', { token: user.token, body: { name: `c${i}` } })),
    );
    for (const r of results) expect(r.status).toBe(201);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(30);
    expect(new Set(results.map((r) => r.body.data.public_slug)).size).toBe(30);
  });

  it('concurrent activity creates in one day all land in that day', async () => {
    const t = await buildTree(req, user.token, 0);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        req('POST', `${t.base}/activities`, { token: user.token, body: { name: `p${i}`, order_index: i } }),
      ),
    );
    for (const r of results) expect(r.status).toBe(201);
    const rows = await sql(dbUrl, 'select count(*)::int as n from activities where day_id=$1', [t.dayId]);
    expect(rows[0]!.n).toBe(20);
  });

  // Deterministic TOCTOU: the ownership check reads the trip, then the parent
  // is deleted before the INSERT. The FK violation (23503) used to hit the
  // route's catch-all and become a 500; since M-09 (Phase 24) the global
  // error handler maps it to a 409 client error.
  it('M-09: create under a trip deleted mid-request → 409 conflict, not 500', async () => {
    const t = await buildTree(req, user.token, 0);
    const locker = new pg.Client({ connectionString: dbUrl });
    await locker.connect();
    try {
      await locker.query('BEGIN');
      await locker.query('DELETE FROM trips WHERE id = $1', [t.tripId]); // uncommitted: row still visible
      const pending = req('POST', `/api/trips/${t.tripId}/destinations`, {
        token: user.token,
        body: { city_name: 'race', country: 'JP' },
      });
      await waitForLockWaiters(dbUrl, 1); // request passed the ownership check, now blocked on the FK lock
      await locker.query('COMMIT');
      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('conflict');
      expect((await sql(dbUrl, 'select 1 from destinations where trip_id=$1', [t.tripId])).length).toBe(0);
    } finally {
      await locker.end();
    }
  });

  it('creating children while the parent trip is being deleted → no orphans, no success after delete', async () => {
    const t = await buildTree(req, user.token, 0);
    const ops = [
      req('DELETE', `/api/trips/${t.tripId}`, { token: user.token }),
      ...Array.from({ length: 10 }, (_, i) =>
        req('POST', `${t.base}/activities`, { token: user.token, body: { name: `race${i}` } }),
      ),
      ...Array.from({ length: 5 }, () =>
        req('POST', `/api/trips/${t.tripId}/destinations`, { token: user.token, body: { city_name: 'r', country: 'r' } }),
      ),
    ];
    const results = await Promise.all(ops);
    // 409 is the M-09 FK race above (was 500 before Phase 24).
    for (const r of results) expect([200, 201, 404, 409], r.text).toContain(r.status);
    const orphans = await sql(dbUrl, 'select 1 from destinations where trip_id=$1', [t.tripId]);
    expect(orphans).toHaveLength(0);
  });

  // No unique constraint on hotels.destination_id and upsertHotel is
  // DELETE-then-INSERT without a transaction, so two PUTs whose DELETEs both
  // run before either INSERT each insert a row. Forced deterministically:
  // a side transaction holds the existing hotel row, both PUTs queue behind
  // it, then it deletes the row itself — both DELETEs find nothing and both
  // INSERTs succeeded. Fixed in Phase 24 (unique hotels.destination_id +
  // atomic upsert, migration 0007); kept as a regression guard.
  it('PHASE-24 (hotel uniqueness): concurrent PUT hotel leaves exactly one hotel row', async () => {
    const t = await buildTree(req, user.token, 0);
    const p = `/api/trips/${t.tripId}/destinations/${t.destId}/hotel`;
    expect((await req('PUT', p, { token: user.token, body: { name: 'H0' } })).status).toBe(200);
    const locker = new pg.Client({ connectionString: dbUrl });
    await locker.connect();
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT id FROM hotels WHERE destination_id = $1 FOR UPDATE', [t.destId]);
      const puts = [1, 2].map((i) => req('PUT', p, { token: user.token, body: { name: `H${i}` } }));
      await waitForLockWaiters(dbUrl, 2);
      await locker.query('DELETE FROM hotels WHERE destination_id = $1', [t.destId]);
      await locker.query('COMMIT');
      for (const r of await Promise.all(puts)) expect(r.status).toBe(200);
    } finally {
      await locker.end();
    }
    const rows = await sql(dbUrl, 'select id from hotels where destination_id=$1', [t.destId]);
    expect(rows).toHaveLength(1);
  });

  // Local driver (src/db/index.ts): every getDb() call builds a new pg.Pool
  // that is never ended — two per authenticated request — each keeping an
  // idle connection for ~10 s and having no 'error' listener. Under load the
  // dev server exhausts max_connections (default 100); a DB restart crashes
  // it. Fixed in Phase 24 (one cached pool per URL); regression guard.
  it('M-01: 40 sequential requests do not leave 40+ idle connections behind', async () => {
    const db = new URL(dbUrl).pathname.slice(1);
    const conns = async () =>
      (await sql<{ n: number }>(dbUrl, 'select count(*)::int as n from pg_stat_activity where datname=$1', [db]))[0]!.n;
    const before = await conns();
    for (let i = 0; i < 40; i++) await req('GET', '/api/trips', { token: user.token });
    expect((await conns()) - before).toBeLessThan(10);
  });

  it('concurrent PATCHes of the same trip: last-writer-wins, row stays valid', async () => {
    const t = await buildTree(req, user.token, 0);
    const names = Array.from({ length: 15 }, (_, i) => `n${i}`);
    const results = await Promise.all(
      names.map((name) => req('PATCH', `/api/trips/${t.tripId}`, { token: user.token, body: { name } })),
    );
    for (const r of results) expect(r.status).toBe(200);
    const final = await sql<{ name: string }>(dbUrl, 'select name from trips where id=$1', [t.tripId]);
    expect(names).toContain(final[0]!.name);
  });

  // -------------------------------------------------------------------------
  // BIZ-07 under load: every response is 2xx or 422, never 500/409, and the
  // database never ends up with an incoherent tree.
  // -------------------------------------------------------------------------

  const BIZ07_VIOLATIONS = `
    SELECT 'day' AS kind, y.id FROM days y JOIN destinations d ON d.id = y.destination_id
      WHERE y.date < d.start_date OR y.date > d.end_date
    UNION ALL
    SELECT 'dest', d.id FROM destinations d JOIN trips t ON t.id = d.trip_id
      WHERE d.start_date < t.start_date OR d.end_date < t.start_date
         OR d.start_date > t.end_date OR d.end_date > t.end_date
    UNION ALL
    SELECT 'overlap', a.id FROM destinations a JOIN destinations b ON a.trip_id = b.trip_id AND a.id < b.id
      WHERE a.start_date < b.end_date AND b.start_date < a.end_date`;

  const iso = (day: number) => `2026-03-${String(day).padStart(2, '0')}`;

  it('BIZ-07: 100 parallel day creates interleaved with destination shrinks/extends stay coherent', async () => {
    const t = await buildTree(req, user.token, 0); // destination 03-01..03-05, day 03-02
    const dest = `/api/trips/${t.tripId}/destinations/${t.destId}`;
    const ops = Array.from({ length: 100 }, (_, i) => {
      if (i % 10 === 0) return req('PATCH', dest, { token: user.token, body: { end_date: iso(2 + (i % 4)) } });
      if (i % 10 === 5) return req('PATCH', dest, { token: user.token, body: { end_date: iso(9) } });
      return req('POST', `${dest}/days`, { token: user.token, body: { date: iso(1 + (i % 9)) } });
    });
    const results = await Promise.all(ops);
    for (const r of results) expect([200, 201, 422], r.text).toContain(r.status);
    expect(results.some((r) => r.status === 201)).toBe(true);
    expect(await sql(dbUrl, BIZ07_VIOLATIONS)).toEqual([]);
  });

  it('BIZ-07: mixed users racing overlapping destinations each get exactly one per range in their own trip', async () => {
    const users = [user, await makeUser(signer), await makeUser(signer), await makeUser(signer)];
    const trips: number[] = [];
    for (const u of users) {
      const r = await req('POST', '/api/trips', { token: u.token, body: { name: 'race', start_date: iso(1), end_date: iso(20) } });
      trips.push(r.body.data.id);
    }
    // 25 identical-range creates per user, all fired at once and interleaved.
    const ops = Array.from({ length: 100 }, (_, i) => {
      const k = i % users.length;
      return req('POST', `/api/trips/${trips[k]}/destinations`, {
        token: users[k]!.token,
        body: { city_name: `C${i}`, country: 'J', start_date: iso(3), end_date: iso(7) },
      });
    });
    const results = await Promise.all(ops);
    for (const r of results) expect([201, 422], r.text).toContain(r.status);
    for (const id of trips) {
      const rows = await sql(dbUrl, 'select id from destinations where trip_id=$1', [id]);
      expect(rows).toHaveLength(1);
    }
    expect(await sql(dbUrl, BIZ07_VIOLATIONS)).toEqual([]);
  });

  it('BIZ-07: trip shrink racing destination creates never leaves a destination outside the trip', async () => {
    const r = await req('POST', '/api/trips', { token: user.token, body: { name: 'shrink', start_date: iso(1), end_date: iso(28) } });
    const tripId = r.body.data.id as number;
    const ops = [
      ...Array.from({ length: 20 }, (_, i) =>
        req('POST', `/api/trips/${tripId}/destinations`, {
          token: user.token,
          body: { city_name: `D${i}`, country: 'J', start_date: iso(1 + i), end_date: iso(1 + i) },
        }),
      ),
      req('PATCH', `/api/trips/${tripId}`, { token: user.token, body: { end_date: iso(10) } }),
      req('PATCH', `/api/trips/${tripId}`, { token: user.token, body: { start_date: iso(5) } }),
    ];
    const results = await Promise.all(ops);
    for (const x of results) expect([200, 201, 422], x.text).toContain(x.status);
    expect(await sql(dbUrl, BIZ07_VIOLATIONS)).toEqual([]);
  });
});
