import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// Coordinates end to end on the real routes. Two layers:
// - BIZ-08/ARCH-05 (Phase 25): Zod rejects out-of-range/NaN → 422 before any SQL.
// - DATA-03: the DB CHECK constraint is the last line of defence for writes
//   that bypass the schema (query layer, scripts, SQL) — tested below.
vi.mock('../middleware/auth', () => import('../test-utils/fake-auth'));

import { closeDbPools, createActivity } from '../db';
import { pgConstraint, pgErrorCode } from '../db/pg-errors';
import { call, snapshotDb } from '../test-utils/app';
import {
  closeTestPool,
  insertActivity,
  insertDay,
  insertDestination,
  insertTrip,
  insertUser,
  resetDb,
  testDb,
  testPool,
} from '../test-utils/db';

beforeEach(async () => {
  await resetDb();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await closeDbPools();
  await closeTestPool();
});

async function tree() {
  const user = await insertUser({ keycloak_id: 'owner', email: 'owner@example.com', name: 'owner' });
  const trip = await insertTrip(user.id);
  const dest = await insertDestination(trip.id);
  const day = await insertDay(dest.id);
  const act = await insertActivity(day.id);
  const base = `/api/trips/${trip.id}/destinations`;
  return {
    dest,
    act,
    createDest: (b: object) => call('POST', base, { sub: 'owner', body: { city_name: 'C', country: 'J', ...b } }),
    putHotel: (b: object) => call('PUT', `${base}/${dest.id}/hotel`, { sub: 'owner', body: { name: 'H', ...b } }),
    createAct: (b: object) => call('POST', `${base}/${dest.id}/days/${day.id}/activities`, { sub: 'owner', body: { name: 'A', ...b } }),
    patchAct: (b: object) => call('PATCH', `${base}/${dest.id}/days/${day.id}/activities/${act.id}`, { sub: 'owner', body: b }),
    patchDest: (b: object) => call('PATCH', `${base}/${dest.id}`, { sub: 'owner', body: b }),
  };
}

const VALID: [string, object][] = [
  ['north pole / antimeridian', { lat: 90, lng: 180 }],
  ['south pole / -antimeridian', { lat: -90, lng: -180 }],
  ['origin', { lat: 0, lng: 0 }],
  ['Tokyo, 7 decimals', { lat: 35.6812362, lng: 139.7671248 }],
  ['numeric strings', { lat: '34.9671', lng: '135.7727' }],
  ['no coordinates', {}],
  ['explicit nulls', { lat: null, lng: null }],
  ['only lat', { lat: 45 }],
];

// [label, coords, offending field]
const INVALID: [string, object, string][] = [
  ['lat just above 90', { lat: 90.0000001, lng: 0 }, 'lat'],
  ['lat just below -90', { lat: -90.0000001, lng: 0 }, 'lat'],
  ['lng just above 180', { lat: 0, lng: 180.0000001 }, 'lng'],
  ['lng just below -180', { lat: 0, lng: -180.0000001 }, 'lng'],
  ['swapped lat/lng (Tokyo)', { lat: 139.7671248, lng: 35.6812362 }, 'lat'],
  ['NaN', { lat: 'NaN', lng: 0 }, 'lat'],
  ['null lat with an out-of-range lng', { lat: null, lng: 181 }, 'lng'],
  ['Infinity', { lat: 'Infinity', lng: 0 }, 'lat'],
  ['1000', { lat: 1000, lng: 0 }, 'lat'],
];

describe.each([
  ['POST destination', 'createDest'],
  ['PUT hotel', 'putHotel'],
  ['POST activity', 'createAct'],
] as const)('%s', (_label, op) => {
  it.each(VALID)('accepts %s', async (_l, coords) => {
    const t = await tree();
    const res = await t[op](coords);
    expect(res.status).toBe(op === 'putHotel' ? 200 : 201);
  });

  it.each(INVALID)('rejects %s with 422 on that field and writes nothing', async (_l, coords, field) => {
    const t = await tree();
    const before = await snapshotDb();
    const res = await t[op](coords);
    expect(res.status).toBe(422);
    expect(res.body['code']).toBe('validation_error');
    expect((res.body['issues'] as { path: string }[]).map((i) => i.path)).toContain(field);
    expect(await snapshotDb()).toBe(before);
  });
});

describe('updates are checked too', () => {
  it('PATCH activity to lat 91 → 422, row unchanged', async () => {
    const t = await tree();
    await testPool().query(`UPDATE activities SET lat = 10, lng = 10 WHERE id = $1`, [t.act.id]);
    const res = await t.patchAct({ lat: 91 });
    expect(res.status).toBe(422);
    const { rows } = await testPool().query('SELECT lat, lng FROM activities WHERE id = $1', [t.act.id]);
    expect(rows[0]).toEqual({ lat: '10.0000000', lng: '10.0000000' });
  });

  it('PATCH destination lng only, keeping a valid lat → 200', async () => {
    const t = await tree();
    const res = await t.patchDest({ lat: 35, lng: -179.9999999 });
    expect(res.status).toBe(200);
    expect(res.body['data']).toMatchObject({ lat: '35.0000000', lng: '-179.9999999' });
  });

  it('renaming an activity is unaffected by the constraint', async () => {
    const t = await tree();
    expect((await t.patchAct({ name: 'Renamed' })).status).toBe(200);
  });
});

describe('the constraint is in the database, not just the API', () => {
  it.each(['destinations', 'hotels', 'activities'])('%s rejects a direct out-of-range insert', async (table) => {
    const t = await tree();
    const cols =
      table === 'destinations'
        ? `(trip_id, city_name, country, lat, lng) VALUES (${t.dest.trip_id}, 'x', 'y', 95, 0)`
        : table === 'hotels'
          ? `(destination_id, name, lat, lng) VALUES (${t.dest.id}, 'x', 95, 0)`
          : `(day_id, name, lat, lng) VALUES (${t.act.day_id}, 'x', 95, 0)`;
    await expect(testPool().query(`INSERT INTO ${table} ${cols}`)).rejects.toMatchObject({
      code: '23514',
      constraint: `${table}_lat_lng_range`,
    });
  });
});

describe('DB CHECK as last line of defence (writes that bypass Zod)', () => {
  it.each([
    ['lat 91', '91', '0'],
    ['lng -181', '0', '-181'],
    ['NaN', 'NaN', '0'],
  ])('query-layer createActivity with %s is rejected by activities_lat_lng_range', async (_l, lat, lng) => {
    const t = await tree();
    await expect(
      createActivity(testDb(), t.act.day_id, { name: 'bypass', lat, lng }),
    ).rejects.toSatisfy((err: unknown) => pgErrorCode(err) === '23514' && pgConstraint(err) === 'activities_lat_lng_range');
  });

  it('the global handler maps a CHECK violation to 400 constraint_violation', async () => {
    const res = await errorHandlerProbe(Object.assign(new Error('x'), { code: '23514' }));
    expect(res).toEqual({ status: 400, code: 'constraint_violation' });
  });
});

async function errorHandlerProbe(err: Error) {
  const { Hono } = await import('hono');
  const { errorHandler } = await import('../middleware/errors');
  const probe = new Hono();
  probe.get('/', () => {
    throw err;
  });
  probe.onError(errorHandler);
  const res = await probe.request('/');
  return { status: res.status, code: ((await res.json()) as { code: string }).code };
}
