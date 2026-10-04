import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// Real routes + real Postgres; only JWT verification is faked (ARCH-03).
vi.mock('../middleware/auth', () => import('../test-utils/fake-auth'));

import { closeDbPools } from '../db';
import { call, snapshotDb } from '../test-utils/app';
import {
  closeTestPool,
  insertActivity,
  insertDay,
  insertDestination,
  insertHotel,
  insertTrip,
  insertUser,
  resetDb,
  testPool,
} from '../test-utils/db';

beforeEach(resetDb);
afterAll(async () => {
  await closeDbPools();
  await closeTestPool();
});

// ---------------------------------------------------------------------------
// Fixture: owner has trips A and B; intruder has trip X.
// ---------------------------------------------------------------------------

async function tree(userId: number) {
  const trip = await insertTrip(userId);
  const dest = await insertDestination(trip.id);
  const hotel = await insertHotel(dest.id);
  const day = await insertDay(dest.id);
  const act = await insertActivity(day.id, { order_index: 0 });
  const act2 = await insertActivity(day.id, { order_index: 1 });
  return { trip: trip.id, dest: dest.id, hotel: hotel.id, day: day.id, act: act.id, act2: act2.id };
}

async function world() {
  const owner = await insertUser({ keycloak_id: 'owner', email: 'owner@example.com', name: 'owner' });
  const intruder = await insertUser({ keycloak_id: 'intruder', email: 'intruder@example.com', name: 'intruder' });
  const A = await tree(owner.id);
  const B = await tree(owner.id);
  const X = await tree(intruder.id);
  return { owner, intruder, A, B, X };
}

type Ids = { trip: number | string; dest: number | string; day: number | string; act: number | string; act2?: number | string };

const T = (i: Ids) => `/api/trips/${i.trip}`;
const D = (i: Ids) => `${T(i)}/destinations/${i.dest}`;
const Y = (i: Ids) => `${D(i)}/days/${i.day}`;
const A_ = (i: Ids) => `${Y(i)}/activities/${i.act}`;

async function count(table: string, where = 'true', params: unknown[] = []): Promise<number> {
  const { rows } = await testPool().query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return rows[0].n;
}

// Every nested (sub-trip) endpoint, for the authorization matrix.
type Level = 'trip' | 'dest' | 'day' | 'act';
interface Endpoint {
  name: string;
  method: string;
  path: (i: Ids) => string;
  body?: (i: Ids) => unknown;
  /** Deepest id the endpoint resolves through. */
  level: Level;
}

const ENDPOINTS: Endpoint[] = [
  { name: 'list destinations', method: 'GET', path: (i) => `${T(i)}/destinations`, level: 'trip' },
  { name: 'create destination', method: 'POST', path: (i) => `${T(i)}/destinations`, level: 'trip', body: () => ({ city_name: 'Nara', country: 'Japan' }) },
  { name: 'update destination', method: 'PATCH', path: D, level: 'dest', body: () => ({ city_name: 'Renamed' }) },
  { name: 'delete destination', method: 'DELETE', path: D, level: 'dest' },
  { name: 'list days', method: 'GET', path: (i) => `${D(i)}/days`, level: 'dest' },
  { name: 'create day', method: 'POST', path: (i) => `${D(i)}/days`, level: 'dest', body: () => ({ date: '2026-03-02' }) },
  { name: 'update day', method: 'PATCH', path: Y, level: 'day', body: () => ({ label: 'Renamed' }) },
  { name: 'delete day', method: 'DELETE', path: Y, level: 'day' },
  { name: 'list activities', method: 'GET', path: (i) => `${Y(i)}/activities`, level: 'day' },
  { name: 'create activity', method: 'POST', path: (i) => `${Y(i)}/activities`, level: 'day', body: () => ({ name: 'Temple' }) },
  { name: 'reorder activities', method: 'POST', path: (i) => `${Y(i)}/activities/reorder`, level: 'day', body: (i) => ({ ordered_ids: [Number(i.act2), Number(i.act)] }) },
  { name: 'update activity', method: 'PATCH', path: A_, level: 'act', body: () => ({ name: 'Renamed' }) },
  { name: 'delete activity', method: 'DELETE', path: A_, level: 'act' },
  { name: 'get hotel', method: 'GET', path: (i) => `${D(i)}/hotel`, level: 'dest' },
  { name: 'put hotel', method: 'PUT', path: (i) => `${D(i)}/hotel`, level: 'dest', body: () => ({ name: 'Ryokan' }) },
  { name: 'delete hotel', method: 'DELETE', path: (i) => `${D(i)}/hotel`, level: 'dest' },
];

const DEPTH: Record<Level, number> = { trip: 0, dest: 1, day: 2, act: 3 };

const TRIP_ENDPOINTS: Endpoint[] = [
  { name: 'get trip', method: 'GET', path: T, level: 'trip' },
  { name: 'update trip', method: 'PATCH', path: T, level: 'trip', body: () => ({ name: 'Hacked' }) },
  { name: 'delete trip', method: 'DELETE', path: T, level: 'trip' },
];

// ===========================================================================
// Authorization matrix
// ===========================================================================

describe('authorization cascade (ARCH-03)', () => {
  describe.each(ENDPOINTS)('$method $name', (ep) => {
    it('401 without authentication, no write', async () => {
      const { A } = await world();
      const before = await snapshotDb();
      const res = await call(ep.method, ep.path(A), { body: ep.body?.(A) });
      expect(res.status).toBe(401);
      expect(await snapshotDb()).toBe(before);
    });

    // SEC-22: "exists but not yours" must be indistinguishable from "does
    // not exist" — same status and byte-identical body — or any user can
    // enumerate which ids exist.
    it("404 for another user's resources, identical to a missing trip, no write", async () => {
      const { A } = await world();
      const before = await snapshotDb();
      const res = await call(ep.method, ep.path(A), { sub: 'intruder', body: ep.body?.(A) });
      const missing = await call(ep.method, ep.path({ ...A, trip: 999_999 }), { sub: 'intruder', body: ep.body?.(A) });
      expect(res.status).toBe(404);
      expect(res.body).toEqual(missing.body);
      expect(await snapshotDb()).toBe(before);
    });

    it("404 for another user's trip even with child ids that do not exist", async () => {
      const { A } = await world();
      const res = await call(
        ep.method,
        ep.path({ ...A, dest: 999_991, day: 999_992, act: 999_993, act2: 999_994 }),
        { sub: 'intruder', body: ep.body?.(A) },
      );
      const owned = await call(
        ep.method,
        ep.path({ ...A, trip: 999_999, dest: 999_991, day: 999_992, act: 999_993, act2: 999_994 }),
        { sub: 'intruder', body: ep.body?.(A) },
      );
      expect(res.status).toBe(404);
      expect(res.body).toEqual(owned.body);
    });

    it('404 for a trip that does not exist', async () => {
      const { A } = await world();
      const res = await call(ep.method, ep.path({ ...A, trip: 999_999 }), { sub: 'owner', body: ep.body?.(A) });
      expect(res.status).toBe(404);
      expect(res.body['success']).toBe(false);
    });

    it('400 for a non-numeric id', async () => {
      const { A } = await world();
      const bad = { ...A, [ep.level === 'trip' ? 'trip' : ep.level]: 'abc' } as Ids;
      const res = await call(ep.method, ep.path(bad), { sub: 'owner', body: ep.body?.(A) });
      expect(res.status).toBe(400);
    });

    if (DEPTH[ep.level] >= 1) {
      it("404 when the owner's destination belongs to a different trip of theirs", async () => {
        const { A, B } = await world();
        const before = await snapshotDb();
        const res = await call(ep.method, ep.path({ ...A, trip: B.trip }), { sub: 'owner', body: ep.body?.(A) });
        expect(res.status).toBe(404);
        expect(await snapshotDb()).toBe(before);
      });

      it("IDOR: intruder's own trip id + owner's destination id → 404, owner data untouched", async () => {
        const { A, X } = await world();
        const before = await snapshotDb();
        const res = await call(ep.method, ep.path({ ...A, trip: X.trip }), { sub: 'intruder', body: ep.body?.(A) });
        expect(res.status).toBe(404);
        expect(await snapshotDb()).toBe(before);
      });

      it('404 for a destination id that does not exist', async () => {
        const { A } = await world();
        const res = await call(ep.method, ep.path({ ...A, dest: 999_999 }), { sub: 'owner', body: ep.body?.(A) });
        expect(res.status).toBe(404);
      });
    }

    if (DEPTH[ep.level] >= 2) {
      it('404 when the day belongs to another destination', async () => {
        const { A, B } = await world();
        const before = await snapshotDb();
        const res = await call(ep.method, ep.path({ ...A, day: B.day }), { sub: 'owner', body: ep.body?.(A) });
        expect(res.status).toBe(404);
        expect(await snapshotDb()).toBe(before);
      });

      it("IDOR: intruder's own trip/destination + owner's day → 404", async () => {
        const { A, X } = await world();
        const before = await snapshotDb();
        const res = await call(ep.method, ep.path({ ...X, day: A.day, act: A.act, act2: A.act2 }), {
          sub: 'intruder',
          body: ep.body?.(A),
        });
        expect(res.status).toBe(404);
        expect(await snapshotDb()).toBe(before);
      });
    }

    if (DEPTH[ep.level] >= 3) {
      it('404 when the activity belongs to another day', async () => {
        const { A, B } = await world();
        const before = await snapshotDb();
        const res = await call(ep.method, ep.path({ ...A, act: B.act }), { sub: 'owner', body: ep.body?.(A) });
        expect(res.status).toBe(404);
        expect(await snapshotDb()).toBe(before);
      });

      it("IDOR: intruder's own day + owner's activity → 404", async () => {
        const { A, X } = await world();
        const before = await snapshotDb();
        const res = await call(ep.method, ep.path({ ...X, act: A.act }), { sub: 'intruder', body: ep.body?.(A) });
        expect(res.status).toBe(404);
        expect(await snapshotDb()).toBe(before);
      });
    }
  });

  describe.each(TRIP_ENDPOINTS)('$method $name', (ep) => {
    it("404 (not 403) for another user's trip — existence is not revealed, no write", async () => {
      const { A } = await world();
      const before = await snapshotDb();
      const res = await call(ep.method, ep.path(A), { sub: 'intruder', body: ep.body?.(A) });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: 'Trip not found' });
      expect(await snapshotDb()).toBe(before);
    });

    it('404 for a missing trip', async () => {
      await world();
      const res = await call(ep.method, `/api/trips/999999`, { sub: 'owner', body: ep.body?.({} as Ids) });
      expect(res.status).toBe(404);
    });

    it('400 for a non-numeric trip id', async () => {
      await world();
      const res = await call(ep.method, `/api/trips/abc`, { sub: 'owner', body: ep.body?.({} as Ids) });
      expect(res.status).toBe(400);
    });

    it('401 without authentication', async () => {
      const { A } = await world();
      expect((await call(ep.method, ep.path(A), { body: ep.body?.(A) })).status).toBe(401);
    });
  });

  it('a brand-new user is provisioned on first request and sees no trips', async () => {
    await world();
    const res = await call('GET', '/api/trips', { sub: 'newcomer' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    expect(await count('users', 'keycloak_id = $1', ['newcomer'])).toBe(1);
  });
});

// ===========================================================================
// Happy paths — owner, exact codes and persisted effects
// ===========================================================================

describe('trips CRUD (owner)', () => {
  it('GET /api/trips lists only the caller’s trips', async () => {
    const { A, B, X } = await world();
    const res = await call('GET', '/api/trips', { sub: 'owner' });
    expect(res.status).toBe(200);
    const ids = (res.body['data'] as { id: number }[]).map((t) => t.id).sort();
    expect(ids).toEqual([A.trip, B.trip].sort());
    expect(ids).not.toContain(X.trip);
  });

  it('POST /api/trips → 201, owned by caller, is_public defaults to false', async () => {
    const { owner } = await world();
    const res = await call('POST', '/api/trips', { sub: 'owner', body: { name: '北海道 ❄️ trip' } });
    expect(res.status).toBe(201);
    expect(res.body['data']).toMatchObject({ name: '北海道 ❄️ trip', user_id: owner.id, is_public: false });
    expect(await count('trips', 'user_id = $1', [owner.id])).toBe(3);
  });

  it.each([
    ['missing name', {}],
    ['empty name', { name: '' }],
    ['256-char name', { name: 'x'.repeat(256) }],
    ['name of wrong type', { name: 42 }],
    ['bad date', { name: 'ok', start_date: '2026-02-30x' }],
    ['non-URL cover image', { name: 'ok', cover_image_url: 'not a url' }],
  ])('POST /api/trips with %s → 422 validation_error, nothing written', async (_l, body) => {
    await world();
    const before = await snapshotDb();
    const res = await call('POST', '/api/trips', { sub: 'owner', body });
    expect(res.status).toBe(422);
    expect(res.body['code']).toBe('validation_error');
    expect(await snapshotDb()).toBe(before);
  });

  it('POST /api/trips ignores a client-supplied user_id (cannot create trips for others)', async () => {
    const { owner, intruder } = await world();
    const res = await call('POST', '/api/trips', { sub: 'intruder', body: { name: 'Mine', user_id: owner.id } });
    expect(res.status).toBe(201);
    expect((res.body['data'] as { user_id: number }).user_id).toBe(intruder.id);
  });

  it('GET /api/trips/:id returns the nested tree', async () => {
    const { A } = await world();
    const res = await call('GET', T(A as Ids), { sub: 'owner' });
    expect(res.status).toBe(200);
    expect(res.body['data']).toMatchObject({
      id: A.trip,
      destinations: [{ id: A.dest, hotel: { id: A.hotel }, days: [{ id: A.day, activities: [{ id: A.act }, { id: A.act2 }] }] }],
    });
  });

  it('PATCH /api/trips/:id → 200 and persists', async () => {
    const { A } = await world();
    const res = await call('PATCH', T(A as Ids), { sub: 'owner', body: { name: 'New', is_public: true } });
    expect(res.status).toBe(200);
    expect(res.body['data']).toMatchObject({ id: A.trip, name: 'New', is_public: true });
  });

  it('DELETE /api/trips/:id → 200 and cascades the whole tree, other trips intact', async () => {
    const { A, B } = await world();
    const res = await call('DELETE', T(A as Ids), { sub: 'owner' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Trip deleted' });
    expect(await count('trips', 'id = $1', [A.trip])).toBe(0);
    expect(await count('destinations', 'trip_id = $1', [A.trip])).toBe(0);
    expect(await count('activities', 'id = $1', [A.act])).toBe(0);
    expect(await count('activities', 'id = $1', [B.act])).toBe(1);
  });

  it('DELETE twice → 200 then 404', async () => {
    const { A } = await world();
    expect((await call('DELETE', T(A as Ids), { sub: 'owner' })).status).toBe(200);
    expect((await call('DELETE', T(A as Ids), { sub: 'owner' })).status).toBe(404);
  });
});

describe('destinations / days / activities / hotel CRUD (owner)', () => {
  it('destination create → list → update → delete (cascade)', async () => {
    const { A } = await world();
    const created = await call('POST', `${T(A as Ids)}/destinations`, {
      sub: 'owner',
      body: { city_name: 'Nara', country: 'Japan', lat: 34.685, lng: 135.805 },
    });
    expect(created.status).toBe(201);
    const dest = created.body['data'] as { id: number; zoom_level: number; lat: string };
    expect(dest).toMatchObject({ city_name: 'Nara', trip_id: A.trip, zoom_level: 12, lat: '34.6850000' });

    const list = await call('GET', `${T(A as Ids)}/destinations`, { sub: 'owner' });
    expect(list.status).toBe(200);
    expect((list.body['data'] as unknown[]).length).toBe(2);

    const patched = await call('PATCH', D({ ...A, dest: dest.id }), { sub: 'owner', body: { city_name: 'Nara-shi' } });
    expect(patched.status).toBe(200);
    expect(patched.body['data']).toMatchObject({ id: dest.id, city_name: 'Nara-shi', country: 'Japan' });

    const removed = await call('DELETE', D(A as Ids), { sub: 'owner' });
    expect(removed.status).toBe(200);
    expect(await count('days', 'destination_id = $1', [A.dest])).toBe(0);
    expect(await count('hotels', 'destination_id = $1', [A.dest])).toBe(0);
  });

  it('day create → update → delete (cascades activities)', async () => {
    const { A } = await world();
    const created = await call('POST', `${D(A as Ids)}/days`, {
      sub: 'owner',
      body: { date: '2026-03-02', label: 'Día 2 — 奈良', color_hex: '#A1B2C3' },
    });
    expect(created.status).toBe(201);
    expect(created.body['data']).toMatchObject({ destination_id: A.dest, date: '2026-03-02', label: 'Día 2 — 奈良' });

    const patched = await call('PATCH', Y(A as Ids), { sub: 'owner', body: { label: 'Arrival' } });
    expect(patched.status).toBe(200);
    expect(patched.body['data']).toMatchObject({ id: A.day, label: 'Arrival' });

    expect((await call('DELETE', Y(A as Ids), { sub: 'owner' })).status).toBe(200);
    expect(await count('activities', 'day_id = $1', [A.day])).toBe(0);
  });

  it.each([
    ['invalid color', { date: '2026-03-02', color_hex: 'red' }],
    ['missing date', { label: 'x' }],
    ['impossible date', { date: '2026-13-45' }],
  ])('POST day with %s → 422, no write', async (_l, body) => {
    const { A } = await world();
    const before = await snapshotDb();
    expect((await call('POST', `${D(A as Ids)}/days`, { sub: 'owner', body })).status).toBe(422);
    expect(await snapshotDb()).toBe(before);
  });

  it('activity create → list → update → delete', async () => {
    const { A } = await world();
    const created = await call('POST', `${Y(A as Ids)}/activities`, {
      sub: 'owner',
      body: { name: 'Tōdai-ji', time: '09:00', is_optional: true, order_index: 2 },
    });
    expect(created.status).toBe(201);
    const act = created.body['data'] as { id: number };
    expect(created.body['data']).toMatchObject({ day_id: A.day, name: 'Tōdai-ji', time: '09:00', is_optional: true });

    const list = await call('GET', `${Y(A as Ids)}/activities`, { sub: 'owner' });
    expect((list.body['data'] as { id: number }[]).map((a) => a.id)).toEqual([A.act, A.act2, act.id]);

    const patched = await call('PATCH', A_({ ...A, act: act.id }), { sub: 'owner', body: { notes: 'bring coins' } });
    expect(patched.status).toBe(200);
    expect(patched.body['data']).toMatchObject({ id: act.id, notes: 'bring coins', name: 'Tōdai-ji' });

    expect((await call('DELETE', A_({ ...A, act: act.id }), { sub: 'owner' })).status).toBe(200);
    expect(await count('activities', 'id = $1', [act.id])).toBe(0);
  });

  it('reorder: full permutation → 200 with new order persisted', async () => {
    const { A } = await world();
    const res = await call('POST', `${Y(A as Ids)}/activities/reorder`, {
      sub: 'owner',
      body: { ordered_ids: [A.act2, A.act] },
    });
    expect(res.status).toBe(200);
    expect((res.body['data'] as { id: number; order_index: number }[]).map((a) => [a.id, a.order_index])).toEqual([
      [A.act2, 0],
      [A.act, 1],
    ]);
  });

  it.each([
    ['partial set', (A: Ids) => [A.act]],
    ['duplicate ids', (A: Ids) => [A.act, A.act]],
    ['empty list', () => []],
  ])('reorder with %s → 400 (BUG-05), nothing written', async (_l, ids) => {
    const { A } = await world();
    const before = await snapshotDb();
    const res = await call('POST', `${Y(A as Ids)}/activities/reorder`, { sub: 'owner', body: { ordered_ids: ids(A as Ids) } });
    expect(res.status).toBe(400);
    expect(await snapshotDb()).toBe(before);
  });

  it("reorder smuggling another user's activity id → 400, neither day changes", async () => {
    const { A, X } = await world();
    const before = await snapshotDb();
    const res = await call('POST', `${Y(A as Ids)}/activities/reorder`, {
      sub: 'owner',
      body: { ordered_ids: [A.act, X.act] },
    });
    expect(res.status).toBe(400);
    expect(await snapshotDb()).toBe(before);
  });

  it.each([
    ['non-positive id', { ordered_ids: [0] }],
    ['string ids', { ordered_ids: ['1'] }],
    ['not an array', { ordered_ids: 5 }],
  ])('reorder with %s → 422 (schema)', async (_l, body) => {
    const { A } = await world();
    expect((await call('POST', `${Y(A as Ids)}/activities/reorder`, { sub: 'owner', body })).status).toBe(422);
  });

  it('hotel: GET → PUT replaces (never two rows) → DELETE → GET 404', async () => {
    const { A } = await world();
    const got = await call('GET', `${D(A as Ids)}/hotel`, { sub: 'owner' });
    expect(got.status).toBe(200);
    expect(got.body['data']).toMatchObject({ id: A.hotel });

    const put = await call('PUT', `${D(A as Ids)}/hotel`, {
      sub: 'owner',
      body: { name: 'Ryokan', url: 'https://example.com/ryokan' },
    });
    expect(put.status).toBe(200);
    expect(put.body['data']).toMatchObject({ destination_id: A.dest, name: 'Ryokan' });
    expect(await count('hotels', 'destination_id = $1', [A.dest])).toBe(1);

    expect((await call('DELETE', `${D(A as Ids)}/hotel`, { sub: 'owner' })).status).toBe(200);
    const gone = await call('GET', `${D(A as Ids)}/hotel`, { sub: 'owner' });
    expect(gone.status).toBe(404);
    expect(gone.body).toEqual({ success: false, error: 'Hotel not found', code: 'hotel_not_found' });
  });

  // Review N1: the editor must tell "no hotel yet" from "destination gone or
  // not yours". Only an owned destination without a hotel carries the code;
  // missing/foreign destinations keep the SEC-22 indistinguishable body.
  it('GET hotel: hotel_not_found only for an owned destination without a hotel', async () => {
    const { A } = await world();
    await call('DELETE', `${D(A as Ids)}/hotel`, { sub: 'owner' });
    const noHotel = await call('GET', `${D(A as Ids)}/hotel`, { sub: 'owner' });
    expect(noHotel.body['code']).toBe('hotel_not_found');

    const missingDest = await call('GET', `${D({ ...(A as Ids), dest: 999_991 })}/hotel`, { sub: 'owner' });
    const foreign = await call('GET', `${D(A as Ids)}/hotel`, { sub: 'intruder' });
    for (const res of [missingDest, foreign]) {
      expect(res.status).toBe(404);
      expect(res.body['code']).toBeUndefined();
      expect(res.body).toEqual({ success: false, error: 'Destination not found' });
    }
  });

  it('hotel: 20 concurrent PUTs leave exactly one row, holding one of the submitted names', async () => {
    const { A } = await world();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        call('PUT', `${D(A as Ids)}/hotel`, { sub: 'owner', body: { name: `H${i}` } }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(200));
    const { rows } = await testPool().query('SELECT id, name FROM hotels WHERE destination_id = $1', [A.dest]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(A.hotel); // replaced in place — id is stable
    expect(rows[0].name).toMatch(/^H\d+$/);
  });

  it('hotel: PUT replaces every field (omitted ones become null)', async () => {
    const { A } = await world();
    await call('PUT', `${D(A as Ids)}/hotel`, {
      sub: 'owner',
      body: { name: 'Full', lat: 35, lng: 139, check_in_date: '2026-03-01', url: 'https://example.com' },
    });
    const res = await call('PUT', `${D(A as Ids)}/hotel`, { sub: 'owner', body: { name: 'Bare' } });
    expect(res.status).toBe(200);
    expect(res.body['data']).toMatchObject({
      id: A.hotel,
      name: 'Bare',
      lat: null,
      lng: null,
      check_in_date: null,
      url: null,
    });
  });

  it('hotel: PUT on a destination without one creates it; DELETE then PUT recreates', async () => {
    const { A } = await world();
    await call('DELETE', `${D(A as Ids)}/hotel`, { sub: 'owner' });
    const res = await call('PUT', `${D(A as Ids)}/hotel`, { sub: 'owner', body: { name: 'New' } });
    expect(res.status).toBe(200);
    expect(res.body['data']).toMatchObject({ destination_id: A.dest, name: 'New' });
    expect(await count('hotels', 'destination_id = $1', [A.dest])).toBe(1);
  });

  it('DELETE hotel when none exists → 200 (idempotent)', async () => {
    const { A } = await world();
    await call('DELETE', `${D(A as Ids)}/hotel`, { sub: 'owner' });
    expect((await call('DELETE', `${D(A as Ids)}/hotel`, { sub: 'owner' })).status).toBe(200);
  });
});

// ===========================================================================
// Hostile / unusual input and racing operations
// ===========================================================================

describe('unusual values and races', () => {
  it('multi-byte names at the length limit round-trip (Zod counts UTF-16 units, Postgres counts characters)', async () => {
    await world();
    const name = '日'.repeat(253) + '🗾'; // .length 255, 254 characters
    const res = await call('POST', '/api/trips', { sub: 'owner', body: { name } });
    expect(res.status).toBe(201);
    expect((res.body['data'] as { name: string }).name).toBe(name);
  });

  it('a ~200 KB unicode note round-trips exactly', async () => {
    const { A } = await world();
    const notes = 'ラーメン🍜 — café\n\t"quotes" \\ backslash '.repeat(5_000);
    const res = await call('POST', `${Y(A as Ids)}/activities`, { sub: 'owner', body: { name: 'Big', notes } });
    expect(res.status).toBe(201);
    const { rows } = await testPool().query('SELECT notes FROM activities WHERE id = $1', [
      (res.body['data'] as { id: number }).id,
    ]);
    expect(rows[0].notes).toBe(notes);
  });

  it('SQL-looking strings are stored literally, never executed', async () => {
    const { A } = await world();
    const name = "'); DROP TABLE trips; --";
    const res = await call('PATCH', T(A as Ids), { sub: 'owner', body: { name } });
    expect(res.status).toBe(200);
    expect(await count('trips')).toBe(3);
    expect((res.body['data'] as { name: string }).name).toBe(name);
  });

  it('a NUL byte in a string → 422 (rejected by validation before Postgres), nothing written', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { A } = await world();
    const before = await snapshotDb();
    const res = await call('PATCH', T(A as Ids), { sub: 'owner', body: { name: 'bad\u0000name' } });
    expect(res.status).toBe(422);
    expect(await snapshotDb()).toBe(before);
    warn.mockRestore();
  });

  it('extra fields (trip_id, id) in a body cannot move or renumber a row', async () => {
    const { A, X } = await world();
    const res = await call('PATCH', D(A as Ids), {
      sub: 'owner',
      body: { city_name: 'Moved?', trip_id: X.trip, id: 424242 },
    });
    expect(res.status).toBe(200);
    expect(res.body['data']).toMatchObject({ id: A.dest, trip_id: A.trip, city_name: 'Moved?' });
  });

  it('deleting a destination while days are being added to it never 500s and leaves no orphans', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { A } = await world();
    const creates = (from: number) =>
      Array.from({ length: 5 }, (_, i) =>
        call('POST', `${D(A as Ids)}/days`, { sub: 'owner', body: { date: `2026-03-${10 + from + i}` } }),
      );
    const results = await Promise.all([...creates(0), call('DELETE', D(A as Ids), { sub: 'owner' }), ...creates(5)]);
    const del = results.splice(5, 1)[0]!;
    expect(del.status).toBe(200);
    // Each create won (201, then cascaded away), lost the ownership check (404)
    // or hit the FK after the delete committed (409). Genuinely racy, so the
    // assertion is the invariant, not one interleaving.
    for (const r of results) expect([201, 404, 409]).toContain(r.status);
    expect(await count('destinations', 'id = $1', [A.dest])).toBe(0);
    expect(await count('days', 'destination_id = $1', [A.dest])).toBe(0);
    warn.mockRestore();
  });

  it('owner and intruder writing the same activity concurrently: only the owner’s writes land', async () => {
    const { A } = await world();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        call('PATCH', A_(A as Ids), {
          sub: i % 2 ? 'intruder' : 'owner',
          body: { name: `${i % 2 ? 'evil' : 'good'}-${i}` },
        }),
      ),
    );
    results.forEach((r, i) => expect(r.status).toBe(i % 2 ? 404 : 200)); // SEC-22: never 403
    const { rows } = await testPool().query('SELECT name FROM activities WHERE id = $1', [A.act]);
    expect(rows[0].name).toMatch(/^good-\d$/);
  });
});

// ===========================================================================
// URL fields are http(s)-only (Phase 25 httpUrl) — verified end to end
// ===========================================================================

describe('URL fields reject non-http(s) schemes', () => {
  const HOSTILE = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>1</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ];

  // [label, request target, body builder, success status]
  const FIELDS: [string, (A: Ids) => [string, string], (url: string) => object, number][] = [
    ['trip cover_image_url', (A) => ['PATCH', T(A)], (url) => ({ cover_image_url: url }), 200],
    ['activity maps_url', (A) => ['POST', `${Y(A)}/activities`], (url) => ({ name: 'x', maps_url: url }), 201],
    ['hotel url', (A) => ['PUT', `${D(A)}/hotel`], (url) => ({ name: 'H', url }), 200],
    ['user avatar_url', () => ['PATCH', '/api/users/me'], (url) => ({ avatar_url: url }), 200],
  ];

  describe.each(FIELDS)('%s', (_label, target, body, okStatus) => {
    it.each(HOSTILE)('%s → 422, nothing written', async (url) => {
      const { A } = await world();
      const [method, path] = target(A as Ids);
      const before = await snapshotDb();
      const res = await call(method, path, { sub: 'owner', body: body(url) });
      expect(res.status).toBe(422);
      expect(res.body['code']).toBe('validation_error');
      expect(await snapshotDb()).toBe(before);
    });

    it.each(['https://example.com/a?b=c#d', 'http://例え.jp/パス'])('%s is accepted', async (url) => {
      const { A } = await world();
      const [method, path] = target(A as Ids);
      const res = await call(method, path, { sub: 'owner', body: body(url) });
      expect(res.status).toBe(okStatus);
    });
  });
});
