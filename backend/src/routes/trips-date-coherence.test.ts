import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// BIZ-07: cross-level date coherence (trip ⊇ destination ⊇ day, no two
// dated destinations of a trip overlapping), on real routes + real Postgres.
// Only JWT verification is faked.
vi.mock('../middleware/auth', () => import('../test-utils/fake-auth'));

import type pg from 'pg';
import { closeDbPools } from '../db';
import { call, snapshotDb } from '../test-utils/app';
import { closeTestPool, resetDb, testDatabaseUrl, testPool } from '../test-utils/db';

beforeEach(resetDb);
afterAll(async () => {
  await closeDbPools();
  await closeTestPool();
});

const OWNER = 'owner';

type Dates = { start_date?: string | null; end_date?: string | null };

async function trip(dates: Dates = {}): Promise<number> {
  const res = await call('POST', '/api/trips', { sub: OWNER, body: { name: 'Trip', ...dates } });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body['data'] as { id: number }).id;
}

function createDest(tripId: number, dates: Dates, city = 'Kyoto') {
  return call('POST', `/api/trips/${tripId}/destinations`, {
    sub: OWNER,
    body: { city_name: city, country: 'Japan', ...dates },
  });
}

async function dest(tripId: number, dates: Dates, city = 'Kyoto'): Promise<number> {
  const res = await createDest(tripId, dates, city);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body['data'] as { id: number }).id;
}

function createDay(tripId: number, destId: number, date: string) {
  return call('POST', `/api/trips/${tripId}/destinations/${destId}/days`, { sub: OWNER, body: { date } });
}

async function day(tripId: number, destId: number, date: string): Promise<number> {
  const res = await createDay(tripId, destId, date);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body['data'] as { id: number }).id;
}

const patchTrip = (tripId: number, body: unknown) => call('PATCH', `/api/trips/${tripId}`, { sub: OWNER, body });
const patchDest = (tripId: number, destId: number, body: unknown) =>
  call('PATCH', `/api/trips/${tripId}/destinations/${destId}`, { sub: OWNER, body });
const patchDay = (tripId: number, destId: number, dayId: number, body: unknown) =>
  call('PATCH', `/api/trips/${tripId}/destinations/${destId}/days/${dayId}`, { sub: OWNER, body });

type Issue = { path: string; message: string };

/** 422 date_conflict with one issue on `path`; returns the message. */
function expectConflict(res: { status: number; body: Record<string, unknown> }, path: string): string {
  expect(res.status, JSON.stringify(res.body)).toBe(422);
  expect(res.body['success']).toBe(false);
  expect(res.body['code']).toBe('date_conflict');
  const issues = res.body['issues'] as Issue[];
  expect(issues).toHaveLength(1);
  expect(issues[0]!.path).toBe(path);
  expect(res.body['error']).toBe(issues[0]!.message);
  return issues[0]!.message;
}

async function row(table: string, id: number): Promise<Record<string, unknown>> {
  // to_jsonb keeps DATE columns as 'YYYY-MM-DD' strings (pg would build JS Dates).
  const { rows } = await testPool().query(`SELECT to_jsonb(x) AS r FROM ${table} x WHERE id = $1`, [id]);
  return rows[0].r;
}

/** Rows of every kind that break a BIZ-07 rule (should always be empty). */
async function violations(): Promise<unknown[]> {
  const { rows } = await testPool().query(`
    SELECT 'day' AS kind, y.id FROM days y JOIN destinations d ON d.id = y.destination_id
      WHERE y.date < d.start_date OR y.date > d.end_date
    UNION ALL
    SELECT 'dest', d.id FROM destinations d JOIN trips t ON t.id = d.trip_id
      WHERE d.start_date < t.start_date OR d.end_date < t.start_date
         OR d.start_date > t.end_date OR d.end_date > t.end_date
    UNION ALL
    SELECT 'overlap', a.id FROM destinations a JOIN destinations b
      ON a.trip_id = b.trip_id AND a.id < b.id
      WHERE a.start_date < b.end_date AND b.start_date < a.end_date
    UNION ALL
    SELECT 'order', id FROM destinations WHERE start_date > end_date
    UNION ALL
    SELECT 'order', id FROM trips WHERE start_date > end_date`);
  return rows;
}

/** Run raw SQL with the BIZ-07 triggers off, to fabricate legacy rows. */
async function legacy(text: string, params: unknown[] = []): Promise<void> {
  const client = await testPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(text, params);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}

/** Wait until `n` other backends of the test DB are blocked on a lock. */
async function waitForLockWaiters(n: number): Promise<void> {
  const dbName = new URL(testDatabaseUrl()).pathname.slice(1);
  const deadline = Date.now() + 10_000;
  for (;;) {
    const { rows } = await testPool().query(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = 'Lock'`,
      [dbName],
    );
    if (rows[0].n >= n) return;
    if (Date.now() > deadline) throw new Error(`only ${rows[0].n}/${n} lock waiters`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Open a side transaction on its own connection (caller commits/rolls back). */
async function sideTx(): Promise<pg.PoolClient> {
  const client = await testPool().connect();
  await client.query('BEGIN');
  return client;
}

// ===========================================================================
// Day within its destination
// ===========================================================================

describe('BIZ-07 day date within the destination range', () => {
  it.each([
    ['the first day', '2026-03-01'],
    ['the last day', '2026-03-05'],
    ['a middle day', '2026-03-03'],
  ])('accepts %s of the range (inclusive bounds)', async (_l, date) => {
    const t = await trip();
    const d = await dest(t, { start_date: '2026-03-01', end_date: '2026-03-05' });
    expect((await createDay(t, d, date)).status).toBe(201);
  });

  it.each([
    ['one day before the start', '2026-02-28'],
    ['one day after the end', '2026-03-06'],
    ['years before', '1999-01-01'],
    ['years after', '2099-12-31'],
  ])('rejects a day %s with 422 date_conflict and writes nothing', async (_l, date) => {
    const t = await trip();
    const d = await dest(t, { start_date: '2026-03-01', end_date: '2026-03-05' });
    const before = await snapshotDb();
    const msg = expectConflict(await createDay(t, d, date), 'date');
    expect(msg).toContain(date);
    expect(msg).toContain('2026-03-01');
    expect(msg).toContain('2026-03-05');
    expect(await snapshotDb()).toBe(before);
  });

  it('destination with only a start date: earlier day rejected, any later day accepted', async () => {
    const t = await trip();
    const d = await dest(t, { start_date: '2026-03-01' });
    expectConflict(await createDay(t, d, '2026-02-28'), 'date');
    expect((await createDay(t, d, '2030-01-01')).status).toBe(201);
  });

  it('destination with only an end date: later day rejected, any earlier day accepted', async () => {
    const t = await trip();
    const d = await dest(t, { end_date: '2026-03-05' });
    expectConflict(await createDay(t, d, '2026-03-06'), 'date');
    expect((await createDay(t, d, '2000-01-01')).status).toBe(201);
  });

  it('destination without dates accepts any day', async () => {
    const t = await trip({ start_date: '2026-03-01', end_date: '2026-03-02' });
    const d = await dest(t, {});
    expect((await createDay(t, d, '1999-01-01')).status).toBe(201);
  });

  it('leap day and year boundary are compared as calendar dates', async () => {
    const t = await trip();
    const leap = await dest(t, { start_date: '2028-02-28', end_date: '2028-03-01' }, 'Leap');
    expect((await createDay(t, leap, '2028-02-29')).status).toBe(201);
    const nye = await dest(t, { start_date: '2026-12-30', end_date: '2027-01-02' }, 'NYE');
    expect((await createDay(t, nye, '2027-01-01')).status).toBe(201);
    expectConflict(await createDay(t, nye, '2027-01-03'), 'date');
    expectConflict(await createDay(t, nye, '2026-12-29'), 'date');
  });

  it('PATCH moving a day outside the range → 422, stored date unchanged', async () => {
    const t = await trip();
    const d = await dest(t, { start_date: '2026-03-01', end_date: '2026-03-05' });
    const y = await day(t, d, '2026-03-02');
    expectConflict(await patchDay(t, d, y, { date: '2026-03-09' }), 'date');
    expect((await row('days', y))['date']).toBe('2026-03-02');
    expect((await patchDay(t, d, y, { date: '2026-03-05' })).status).toBe(200);
  });

  it('PATCH of a legacy out-of-range day that does not touch its date still works', async () => {
    const t = await trip();
    const d = await dest(t, { start_date: '2026-03-01', end_date: '2026-03-05' });
    const y = await day(t, d, '2026-03-02');
    await legacy(`UPDATE days SET date = '2026-04-01' WHERE id = $1`, [y]);
    const res = await patchDay(t, d, y, { label: 'renamed', order_index: 3 });
    expect(res.status).toBe(200);
    // ...but re-sending the bad date is checked like any other write.
    expectConflict(await patchDay(t, d, y, { date: '2026-04-01' }), 'date');
  });
});

// ===========================================================================
// Destination within its trip
// ===========================================================================

describe('BIZ-07 destination range within the trip range', () => {
  const T = { start_date: '2026-03-01', end_date: '2026-03-10' };

  it('accepts a destination equal to the trip range', async () => {
    const t = await trip(T);
    expect((await createDest(t, T)).status).toBe(201);
  });

  it.each([
    ['starts before the trip', { start_date: '2026-02-28', end_date: '2026-03-05' }, 'start_date'],
    ['ends after the trip', { start_date: '2026-03-05', end_date: '2026-03-11' }, 'end_date'],
    ['lies entirely after the trip', { start_date: '2026-03-11', end_date: '2026-03-12' }, 'start_date'],
    ['lies entirely before the trip', { start_date: '2026-02-01', end_date: '2026-02-02' }, 'start_date'],
    ['has only a start date, before the trip', { start_date: '2026-02-01' }, 'start_date'],
    ['has only an end date, after the trip', { end_date: '2026-04-01' }, 'end_date'],
    ['has only a start date, after the trip end', { start_date: '2026-03-11' }, 'start_date'],
  ])('rejects a destination that %s', async (_l, dates, path) => {
    const t = await trip(T);
    const before = await snapshotDb();
    const msg = expectConflict(await createDest(t, dates), path);
    expect(msg).toContain('2026-03-01');
    expect(msg).toContain('2026-03-10');
    expect(await snapshotDb()).toBe(before);
  });

  it('trip with only a start date bounds destinations from below only', async () => {
    const t = await trip({ start_date: '2026-03-01' });
    expectConflict(await createDest(t, { start_date: '2026-02-01', end_date: '2026-02-05' }), 'start_date');
    expect((await createDest(t, { start_date: '2027-01-01', end_date: '2027-01-05' })).status).toBe(201);
  });

  it('trip without dates accepts any destination; destination without dates fits any trip', async () => {
    const free = await trip();
    expect((await createDest(free, { start_date: '1990-01-01', end_date: '2090-01-01' })).status).toBe(201);
    const t = await trip(T);
    expect((await createDest(t, {})).status).toBe(201);
  });

  it('PATCH sending only end_date is compared with the stored start_date and trip range', async () => {
    const t = await trip(T);
    const d = await dest(t, { start_date: '2026-03-03', end_date: '2026-03-05' });
    // Phase 25 gap: one date in the body, the other stored.
    expectConflict(await patchDest(t, d, { end_date: '2026-03-02' }), 'end_date');
    expectConflict(await patchDest(t, d, { end_date: '2026-03-11' }), 'end_date');
    expectConflict(await patchDest(t, d, { start_date: '2026-03-06' }), 'start_date');
    expectConflict(await patchDest(t, d, { start_date: '2026-02-27' }), 'start_date');
    expect(await row('destinations', d)).toMatchObject({ start_date: '2026-03-03', end_date: '2026-03-05' });
    expect((await patchDest(t, d, { end_date: '2026-03-03' })).status).toBe(200); // equal dates OK
  });

  it('PATCH trip with only one date is compared with the stored other date', async () => {
    const t = await trip(T);
    expectConflict(await patchTrip(t, { end_date: '2026-02-28' }), 'end_date');
    expectConflict(await patchTrip(t, { start_date: '2026-03-11' }), 'start_date');
    expect(await row('trips', t)).toMatchObject({ start_date: '2026-03-01', end_date: '2026-03-10' });
    expect((await patchTrip(t, { start_date: '2026-03-10' })).status).toBe(200);
  });
});

// ===========================================================================
// Shrinking a parent that would orphan children → 422 (decision)
// ===========================================================================

describe('BIZ-07 shrinking a parent range never orphans children', () => {
  it('trip shrink that would leave a destination outside → 422 naming it, trip unchanged', async () => {
    const t = await trip({ start_date: '2026-03-01', end_date: '2026-03-10' });
    await dest(t, { start_date: '2026-03-01', end_date: '2026-03-04' }, 'Tokyo');
    await dest(t, { start_date: '2026-03-06', end_date: '2026-03-09' }, 'Osaka');
    const msg = expectConflict(await patchTrip(t, { end_date: '2026-03-07' }), 'end_date');
    expect(msg).toContain('Osaka');
    expect(msg).toContain('2026-03-06');
    expect((await row('trips', t))['end_date']).toBe('2026-03-10');
    // Shrinking to exactly fit is fine, and so is clearing the dates.
    expect((await patchTrip(t, { end_date: '2026-03-09', start_date: '2026-03-01' })).status).toBe(200);
    expect((await patchTrip(t, { start_date: null, end_date: null })).status).toBe(200);
  });

  it('trip moved so that a single-date destination falls outside → 422', async () => {
    const t = await trip({ start_date: '2026-03-01', end_date: '2026-03-10' });
    await dest(t, { start_date: '2026-03-02' }, 'Nara');
    expectConflict(await patchTrip(t, { start_date: '2026-03-03' }), 'start_date');
  });

  it('destination shrink that would leave days outside → 422 with count, destination unchanged', async () => {
    const t = await trip();
    const d = await dest(t, { start_date: '2026-03-01', end_date: '2026-03-05' });
    for (const date of ['2026-03-01', '2026-03-02', '2026-03-04', '2026-03-05']) await day(t, d, date);
    const msg = expectConflict(await patchDest(t, d, { start_date: '2026-03-02', end_date: '2026-03-03' }), 'start_date');
    expect(msg).toMatch(/3 days/);
    expect(msg).toContain('2026-03-01');
    expect(msg).toContain('2026-03-05');
    expect(await row('destinations', d)).toMatchObject({ start_date: '2026-03-01', end_date: '2026-03-05' });
    const only = expectConflict(await patchDest(t, d, { end_date: '2026-03-04' }), 'end_date');
    expect(only).toMatch(/1 day\b/);
    expect((await patchDest(t, d, { start_date: null, end_date: null })).status).toBe(200);
  });

  it('after deleting the orphaned children the shrink succeeds', async () => {
    const t = await trip();
    const d = await dest(t, { start_date: '2026-03-01', end_date: '2026-03-05' });
    const late = await day(t, d, '2026-03-05');
    expectConflict(await patchDest(t, d, { end_date: '2026-03-04' }), 'end_date');
    expect((await call('DELETE', `/api/trips/${t}/destinations/${d}/days/${late}`, { sub: OWNER })).status).toBe(200);
    expect((await patchDest(t, d, { end_date: '2026-03-04' })).status).toBe(200);
  });
});

// ===========================================================================
// No overlapping destinations within a trip
// ===========================================================================

describe('BIZ-07 destinations of a trip do not overlap', () => {
  const A = { start_date: '2026-03-01', end_date: '2026-03-05' };

  it.each([
    ['touching at the end (A ends the day B starts)', { start_date: '2026-03-05', end_date: '2026-03-08' }],
    ['touching at the start', { start_date: '2026-02-25', end_date: '2026-03-01' }],
    ['a single day on A’s last day', { start_date: '2026-03-05', end_date: '2026-03-05' }],
    ['entirely after', { start_date: '2026-03-06', end_date: '2026-03-07' }],
    ['undated', {}],
    ['start date only, inside A', { start_date: '2026-03-03' }],
  ])('allows a second destination %s', async (_l, dates) => {
    const t = await trip();
    await dest(t, A, 'Tokyo');
    expect((await createDest(t, dates, 'Kyoto')).status).toBe(201);
  });

  it.each([
    ['overlapping the end', { start_date: '2026-03-04', end_date: '2026-03-06' }, 'start_date'],
    ['overlapping the start', { start_date: '2026-02-27', end_date: '2026-03-02' }, 'end_date'],
    ['identical', A, 'start_date'],
    ['nested inside', { start_date: '2026-03-02', end_date: '2026-03-03' }, 'start_date'],
    ['enclosing', { start_date: '2026-02-20', end_date: '2026-03-20' }, 'end_date'],
    ['a single day strictly inside', { start_date: '2026-03-03', end_date: '2026-03-03' }, 'start_date'],
  ])('rejects a second destination %s, naming the other one', async (_l, dates, path) => {
    const t = await trip();
    await dest(t, A, 'Tokyo');
    const before = await snapshotDb();
    const msg = expectConflict(await createDest(t, dates, 'Kyoto'), path);
    expect(msg).toContain('Tokyo');
    expect(msg).toContain('2026-03-01');
    expect(await snapshotDb()).toBe(before);
  });

  it('the same range in another trip (or another user’s trip) is fine', async () => {
    const t1 = await trip();
    const t2 = await trip();
    await dest(t1, A);
    expect((await createDest(t2, A)).status).toBe(201);
    const other = await call('POST', '/api/trips', { sub: 'someone-else', body: { name: 'x' } });
    const t3 = (other.body['data'] as { id: number }).id;
    const res = await call('POST', `/api/trips/${t3}/destinations`, {
      sub: 'someone-else',
      body: { city_name: 'K', country: 'J', ...A },
    });
    expect(res.status).toBe(201);
  });

  it('PATCH into a sibling’s range → 422; re-sending its own range is not a self-overlap', async () => {
    const t = await trip();
    await dest(t, A, 'Tokyo');
    const b = await dest(t, { start_date: '2026-03-05', end_date: '2026-03-08' }, 'Kyoto');
    expectConflict(await patchDest(t, b, { start_date: '2026-03-04' }), 'start_date');
    expect((await patchDest(t, b, { start_date: '2026-03-05', end_date: '2026-03-08' })).status).toBe(200);
  });

  it('dating a previously undated destination is checked against its siblings', async () => {
    const t = await trip();
    await dest(t, A, 'Tokyo');
    const b = await dest(t, {}, 'Kyoto');
    expectConflict(await patchDest(t, b, { start_date: '2026-03-02', end_date: '2026-03-03' }), 'start_date');
    expect((await patchDest(t, b, { start_date: '2026-03-06', end_date: '2026-03-07' })).status).toBe(200);
  });

  it('reordering / renaming destinations does not re-run date checks (legacy overlap stays editable)', async () => {
    const t = await trip();
    const a = await dest(t, A, 'Tokyo');
    const b = await dest(t, { start_date: '2026-03-06', end_date: '2026-03-08' }, 'Kyoto');
    await legacy(`UPDATE destinations SET start_date = '2026-03-02' WHERE id = $1`, [b]);
    expect((await patchDest(t, b, { order_index: 0, city_name: 'Kyoto (old)' })).status).toBe(200);
    expect((await patchDest(t, a, { order_index: 1 })).status).toBe(200);
    // Any write touching the dates must resolve the overlap.
    expectConflict(await patchDest(t, b, { end_date: '2026-03-09' }), 'end_date');
  });
});

// ===========================================================================
// Error body contract
// ===========================================================================

describe('BIZ-07 error body', () => {
  it('is 422 { success:false, code:"date_conflict", error, issues:[{path,message}] } and leaks no SQL', async () => {
    const t = await trip();
    const d = await dest(t, { start_date: '2026-03-01', end_date: '2026-03-05' });
    const res = await createDay(t, d, '2026-03-09');
    expect(Object.keys(res.body).sort()).toEqual(['code', 'error', 'issues', 'success']);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/insert into|DrizzleQueryError|plpgsql|SQLSTATE|DC00/i);
  });

  it('a city name with quotes and unicode is quoted verbatim in the message', async () => {
    const t = await trip();
    await dest(t, { start_date: '2026-03-01', end_date: '2026-03-05' }, 'Kyōto "old" 京都');
    const msg = expectConflict(await createDest(t, { start_date: '2026-03-02', end_date: '2026-03-03' }), 'start_date');
    expect(msg).toContain('Kyōto "old" 京都');
  });
});

// ===========================================================================
// Concurrency — two writes that are each fine alone must not jointly break
// a rule. Interleavings are forced with side transactions holding locks.
// ===========================================================================

describe('BIZ-07 under concurrency', () => {
  it('20 parallel creates of the same range in one trip → exactly one wins', async () => {
    const t = await trip();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createDest(t, { start_date: '2026-03-01', end_date: '2026-03-05' }, `C${i}`)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 422)).toHaveLength(19);
    expect(await violations()).toEqual([]);
  });

  it('30 parallel creates of mixed, partly overlapping ranges leave no overlap', async () => {
    const t = await trip();
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => {
        const s = 1 + (i % 10);
        const pad = (n: number) => String(n).padStart(2, '0');
        return createDest(t, { start_date: `2026-03-${pad(s)}`, end_date: `2026-03-${pad(s + (i % 3))}` }, `C${i}`);
      }),
    );
    expect(results.every((r) => r.status === 201 || r.status === 422)).toBe(true);
    expect(await violations()).toEqual([]);
  });

  it('forced: an uncommitted overlapping destination makes the request wait, then 422', async () => {
    const t = await trip();
    const side = await sideTx();
    try {
      await side.query(
        `INSERT INTO destinations (trip_id, city_name, country, start_date, end_date) VALUES ($1, 'Side', 'J', '2026-03-01', '2026-03-05')`,
        [t],
      );
      const pending = createDest(t, { start_date: '2026-03-03', end_date: '2026-03-06' });
      await waitForLockWaiters(1);
      await side.query('COMMIT');
      expectConflict(await pending, 'start_date');
    } finally {
      side.release();
    }
    expect(await violations()).toEqual([]);
  });

  it('forced: destination shrink waits for an uncommitted day, then 422', async () => {
    const t = await trip();
    const d = await dest(t, { start_date: '2026-03-01', end_date: '2026-03-05' });
    const side = await sideTx();
    try {
      await side.query(`INSERT INTO days (destination_id, date) VALUES ($1, '2026-03-05')`, [d]);
      const pending = patchDest(t, d, { end_date: '2026-03-03' });
      await waitForLockWaiters(1);
      await side.query('COMMIT');
      expectConflict(await pending, 'end_date');
    } finally {
      side.release();
    }
    expect(await violations()).toEqual([]);
  });

  it('forced: a day insert waits for an uncommitted destination shrink, then 422', async () => {
    const t = await trip();
    const d = await dest(t, { start_date: '2026-03-01', end_date: '2026-03-05' });
    const side = await sideTx();
    try {
      await side.query(`UPDATE destinations SET end_date = '2026-03-03' WHERE id = $1`, [d]);
      const pending = createDay(t, d, '2026-03-05');
      await waitForLockWaiters(1);
      await side.query('COMMIT');
      expectConflict(await pending, 'date');
    } finally {
      side.release();
    }
    expect(await violations()).toEqual([]);
  });

  it('forced: trip shrink waits for an uncommitted destination, then 422', async () => {
    const t = await trip({ start_date: '2026-03-01', end_date: '2026-03-10' });
    const side = await sideTx();
    try {
      await side.query(
        `INSERT INTO destinations (trip_id, city_name, country, start_date, end_date) VALUES ($1, 'Late', 'J', '2026-03-08', '2026-03-10')`,
        [t],
      );
      const pending = patchTrip(t, { end_date: '2026-03-05' });
      await waitForLockWaiters(1);
      await side.query('COMMIT');
      expect(expectConflict(await pending, 'end_date')).toContain('Late');
    } finally {
      side.release();
    }
    expect(await violations()).toEqual([]);
  });

  it('forced: a destination create waits for an uncommitted trip shrink, then 422', async () => {
    const t = await trip({ start_date: '2026-03-01', end_date: '2026-03-10' });
    const side = await sideTx();
    try {
      await side.query(`UPDATE trips SET end_date = '2026-03-05' WHERE id = $1`, [t]);
      const pending = createDest(t, { start_date: '2026-03-07', end_date: '2026-03-09' });
      await waitForLockWaiters(1);
      await side.query('COMMIT');
      expectConflict(await pending, 'start_date');
    } finally {
      side.release();
    }
    expect(await violations()).toEqual([]);
  });

  // Deadlock guard: a destination UPDATE already holds its own row when its
  // trigger runs. If the trigger then waited on the trip ROW, a concurrent
  // trip DELETE (trip row locked, cascading into that destination) would
  // deadlock with it. The per-trip lock is therefore an advisory lock that
  // a trip delete never takes; a row lock on the trip must not block it.
  it('a destination date edit does not wait on a lock held on the trip row (no deadlock with trip delete)', async () => {
    const t = await trip({ start_date: '2026-03-01', end_date: '2026-03-10' });
    const d = await dest(t, { start_date: '2026-03-01', end_date: '2026-03-05' });
    const side = await sideTx();
    try {
      await side.query('SELECT id FROM trips WHERE id = $1 FOR UPDATE', [t]);
      const res = await Promise.race([
        patchDest(t, d, { end_date: '2026-03-06' }),
        new Promise<'blocked'>((r) => setTimeout(() => r('blocked'), 2_000)),
      ]);
      expect(res === 'blocked' ? res : res.status).toBe(200);
    } finally {
      await side.query('ROLLBACK');
      side.release();
    }
  });

  it('trip delete racing destination date edits: no deadlock, no 500', async () => {
    for (let round = 0; round < 5; round++) {
      const t = await trip({ start_date: '2026-03-01', end_date: '2026-03-20' });
      const ids = [];
      for (let i = 0; i < 4; i++) {
        ids.push(await dest(t, { start_date: `2026-03-0${1 + 2 * i}`, end_date: `2026-03-0${2 + 2 * i}` }, `D${i}`));
      }
      const results = await Promise.all([
        ...ids.map((d) => patchDest(t, d, { order_index: 1, city_name: 'x' })),
        ...ids.map((d, i) => patchDest(t, d, { end_date: `2026-03-0${2 + 2 * i}` })),
        call('DELETE', `/api/trips/${t}`, { sub: OWNER }),
      ]);
      for (const r of results) expect([200, 404, 409], JSON.stringify(r.body)).toContain(r.status);
    }
  });

  it.each([
    ['destination', (t: number, d: number) => patchDest(t, d, { end_date: '2026-03-04' })],
    ['day', (t: number, d: number, y: number) => patchDay(t, d, y, { label: 'x' })],
    ['activity', (t: number, d: number, y: number, a: number) =>
      call('PATCH', `/api/trips/${t}/destinations/${d}/days/${y}/activities/${a}`, { sub: OWNER, body: { name: 'x' } })],
  ] as const)('forced: PATCH %s whose trip is deleted mid-request → 404, not 500', async (_l, patch) => {
    const t = await trip({ start_date: '2026-03-01', end_date: '2026-03-10' });
    const d = await dest(t, { start_date: '2026-03-01', end_date: '2026-03-05' });
    const y = await day(t, d, '2026-03-02');
    const act = await call('POST', `/api/trips/${t}/destinations/${d}/days/${y}/activities`, { sub: OWNER, body: { name: 'a' } });
    const a = (act.body['data'] as { id: number }).id;
    const side = await sideTx();
    try {
      // The delete holds the rows; the PATCH passes its ownership check
      // (snapshot still has the trip) and then waits on the row lock.
      await side.query('DELETE FROM trips WHERE id = $1', [t]);
      const pending = patch(t, d, y, a);
      await waitForLockWaiters(1);
      await side.query('COMMIT');
      const res = await pending;
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    } finally {
      side.release();
    }
  });

  it('a rolled-back conflicting write does not block the real one', async () => {
    const t = await trip();
    const side = await sideTx();
    try {
      await side.query(
        `INSERT INTO destinations (trip_id, city_name, country, start_date, end_date) VALUES ($1, 'Ghost', 'J', '2026-03-01', '2026-03-05')`,
        [t],
      );
      const pending = createDest(t, { start_date: '2026-03-02', end_date: '2026-03-04' });
      await waitForLockWaiters(1);
      await side.query('ROLLBACK');
      expect((await pending).status).toBe(201);
    } finally {
      side.release();
    }
  });

  it('parallel shrink + day creates: the final state is always coherent', async () => {
    for (let round = 0; round < 5; round++) {
      await resetDb();
      const t = await trip();
      const d = await dest(t, { start_date: '2026-03-01', end_date: '2026-03-10' });
      const results = await Promise.all([
        patchDest(t, d, { end_date: '2026-03-03' }),
        ...['2026-03-02', '2026-03-05', '2026-03-08', '2026-03-10'].map((date) => createDay(t, d, date)),
        patchDest(t, d, { start_date: '2026-03-04' }),
      ]);
      for (const r of results) expect([200, 201, 422]).toContain(r.status);
      expect(await violations()).toEqual([]);
    }
  });
});
