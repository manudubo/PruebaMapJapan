import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context, Next } from 'hono';

// Route-level validation tests (ARCH-05, BIZ-06/08/09): auth, user
// provisioning and the DB are mocked — the unit suite has no Keycloak or real
// Postgres (ARCH-06). What is under test is the HTTP contract: invalid bodies
// get 422 before any handler/DB work; valid bodies reach the query layer with
// the parsed values.
vi.mock('../middleware/auth', () => ({
  authMiddleware: async (c: Context, next: Next) => {
    c.set('user', { sub: 'kc-1', email: 'user@example.com', name: 'U', preferred_username: 'u' });
    await next();
  },
}));
vi.mock('../middleware/user', () => ({
  userClaimsFromJwt: () => ({ keycloak_id: 'kc-1', email: 'user@example.com', name: 'U' }),
  ensureUserProvisioned: async (c: Context, next: Next) => {
    c.set('dbUserId', 1);
    await next();
  },
}));

// Ownership rows returned by the fake db's select() chain, keyed by table.
const ownedRows = vi.hoisted(() => new Map<unknown, unknown[]>());

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>();
  const fakeDb = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({ limit: async () => ownedRows.get(table) ?? [] }),
      }),
    }),
  };
  return {
    ...actual,
    getDb: () => fakeDb,
    createTrip: vi.fn(async (_db: unknown, userId: number, data: object) => ({ id: 1, user_id: userId, ...data })),
    updateTrip: vi.fn(async (_db: unknown, id: number, _u: number, data: object) => ({ id, ...data })),
    createDestination: vi.fn(async (_db: unknown, tripId: number, data: object) => ({ id: 2, trip_id: tripId, ...data })),
    updateDestination: vi.fn(async (_db: unknown, id: number, data: object) => ({ id, ...data })),
    updateDay: vi.fn(async (_db: unknown, id: number, data: object) => ({ id, ...data })),
    createActivity: vi.fn(async (_db: unknown, dayId: number, data: object) => ({ id: 4, day_id: dayId, ...data })),
    updateActivity: vi.fn(async (_db: unknown, id: number, data: object) => ({ id, ...data })),
    upsertHotel: vi.fn(async (_db: unknown, destId: number, data: object) => ({ id: 5, destination_id: destId, ...data })),
    updateUser: vi.fn(async (_db: unknown, _sub: string, data: object) => ({ id: 1, ...data })),
    getUserByKeycloakId: vi.fn(async () => ({ id: 1 })),
  };
});

// Ownership is a single-JOIN query since M-02 (db/queries/ownership.ts); the
// real cascade is covered on Postgres by trips.test.ts, so it is stubbed as
// "owned" here to keep this file about the HTTP validation contract.
vi.mock('../db/queries/ownership', () => ({
  resolveTrip: async (_db: unknown, tripId: number) => ({ tripId }),
  resolveDestination: async () => ({ dest: { id: 2, trip_id: 1 } }),
  resolveDay: async () => ({ dest: { id: 2, trip_id: 1 }, day: { id: 3, destination_id: 2 } }),
  resolveActivity: async () => ({
    dest: { id: 2, trip_id: 1 },
    day: { id: 3, destination_id: 2 },
    act: { id: 4, day_id: 3 },
  }),
}));

import app from '../index';
import type { Env } from '../types';
import * as db from '../db';
import { trips, destinations, days, activities } from '../db/schema';

const mockEnv: Env = {
  DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'japan-trip',
  VALID_AUDIENCES: 'japan-trip-frontend',
  KC_ADMIN_CLIENT_ID: 'japan-trip-worker',
  KC_ADMIN_CLIENT_SECRET: 'mock-secret',
  OTP_SECRET: 'aaaabbbbccccddddeeeeffffaaaabbbbccccddddeeeeffffaaaabbbbccccddd0',
  // This file is about request validation; the verified-email gate has its own suites.
  REQUIRE_VERIFIED_EMAIL: 'false',
};

const TRIP = '/api/trips/1';
const DEST = `${TRIP}/destinations/2`;
const DAY = `${DEST}/days/3`;
const ACT = `${DAY}/activities/4`;

async function send(method: string, path: string, body: unknown): Promise<Response> {
  return app.request(
    path,
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    mockEnv,
  );
}

type ErrorBody = { success: boolean; code: string; issues: { path: string; message: string }[] };

beforeEach(() => {
  vi.clearAllMocks();
  ownedRows.clear();
  ownedRows.set(trips, [{ id: 1, user_id: 1 }]);
  ownedRows.set(destinations, [{ id: 2, trip_id: 1 }]);
  ownedRows.set(days, [{ id: 3, destination_id: 2 }]);
  ownedRows.set(activities, [{ id: 4, day_id: 3 }]);
});

// ---------------------------------------------------------------------------
// BIZ-09 — PATCH with nothing to change is rejected
// ---------------------------------------------------------------------------

describe('PATCH with no fields → 422 (BIZ-09)', () => {
  it.each([
    ['trip', TRIP],
    ['destination', DEST],
    ['day', DAY],
    ['activity', ACT],
    ['user', '/api/users/me'],
  ])('%s: {} → 422 validation_error', async (_label, path) => {
    const res = await send('PATCH', path, {});
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorBody;
    expect(body.success).toBe(false);
    expect(body.code).toBe('validation_error');
    expect(body.issues[0].message).toMatch(/at least one field/);
  });

  it.each([
    ['only unknown keys', { bogus: 1, user_id: 99 }],
    ['explicit undefined only (serialises to {})', { name: undefined }],
  ])('trip: %s → 422', async (_label, payload) => {
    const res = await send('PATCH', TRIP, payload);
    expect(res.status).toBe(422);
    expect(db.updateTrip).not.toHaveBeenCalled();
  });

  it.each([
    ['truncated object', '{not json'],
    ['bare string', 'hello'],
  ])('malformed JSON (%s) → 400, not 500 and not 422', async (_label, raw) => {
    const res = await send('PATCH', TRIP, raw);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body).toEqual({ success: false, error: 'Malformed JSON in request body' });
    expect(db.updateTrip).not.toHaveBeenCalled();
  });

  it('trip: a single real field is enough → 200', async () => {
    const res = await send('PATCH', TRIP, { is_public: true });
    expect(res.status).toBe(200);
    expect(db.updateTrip).toHaveBeenCalledWith(expect.anything(), 1, 1, { is_public: true });
  });

  it('trip: explicitly clearing a field with null counts as a change → 200', async () => {
    const res = await send('PATCH', TRIP, { description: null });
    expect(res.status).toBe(200);
  });

  it('trip: PATCH does not inject the create-time is_public default', async () => {
    await send('PATCH', TRIP, { name: 'Renamed' });
    expect(db.updateTrip).toHaveBeenCalledWith(expect.anything(), 1, 1, { name: 'Renamed' });
  });
});

// ---------------------------------------------------------------------------
// BIZ-06 — date order at the HTTP layer
// ---------------------------------------------------------------------------

describe('date order over HTTP (BIZ-06)', () => {
  it('POST trip with start > end → 422 on end_date, nothing created', async () => {
    const res = await send('POST', '/api/trips', { name: 'T', start_date: '2026-03-24', end_date: '2026-02-22' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorBody;
    expect(body.issues).toEqual([{ path: 'end_date', message: 'end_date must be on or after start_date' }]);
    expect(db.createTrip).not.toHaveBeenCalled();
  });

  it('POST trip with only a start date (partial) → 201', async () => {
    const res = await send('POST', '/api/trips', { name: 'T', start_date: '2026-02-22' });
    expect(res.status).toBe(201);
  });

  it('PATCH destination with equal dates → 200', async () => {
    const res = await send('PATCH', DEST, { start_date: '2026-02-22', end_date: '2026-02-22' });
    expect(res.status).toBe(200);
  });

  it('PUT hotel with check-out before check-in → 422 on check_out_date', async () => {
    const res = await send('PUT', `${DEST}/hotel`, {
      name: 'H',
      check_in_date: '2026-02-25',
      check_out_date: '2026-02-24',
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorBody;
    expect(body.issues[0].path).toBe('check_out_date');
    expect(db.upsertHotel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BIZ-08 — coordinates at the HTTP layer
// ---------------------------------------------------------------------------

describe('coordinates over HTTP (BIZ-08)', () => {
  it.each([
    ['"NaN"', 'NaN'],
    ['"null"', 'null'],
    ['empty string', ''],
    ['91', 91],
  ])('POST activity with lat %s → 422', async (_label, lat) => {
    const res = await send('POST', `${DAY}/activities`, { name: 'A', lat, lng: 139 });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorBody;
    expect(body.issues[0].path).toBe('lat');
    expect(db.createActivity).not.toHaveBeenCalled();
  });

  it('POST destination with lng 180.5 → 422', async () => {
    const res = await send('POST', `${TRIP}/destinations`, { city_name: 'X', country: 'Y', lng: 180.5 });
    expect(res.status).toBe(422);
  });

  it('boundary coordinates reach the query layer as strings', async () => {
    const res = await send('POST', `${DAY}/activities`, { name: 'Pole', lat: -90, lng: 180 });
    expect(res.status).toBe(201);
    expect(db.createActivity).toHaveBeenCalledWith(
      expect.anything(),
      3,
      expect.objectContaining({ lat: '-90', lng: '180' }),
    );
  });
});

// ---------------------------------------------------------------------------
// BIZ-01..05 — every editor field reaches the query layer
// ---------------------------------------------------------------------------

describe('activity editor fields over HTTP (BIZ-01..04)', () => {
  const full = {
    name: 'Shibuya area',
    lat: 35.6595,
    lng: 139.7005,
    notes: 'Walk around',
    is_optional: true,
    is_generic: true,
    maps_url: 'https://maps.google.com/?q=Shibuya',
    time: '09:30',
  };

  it('POST passes is_optional/is_generic/maps_url/time through (is_generic was dropped)', async () => {
    const res = await send('POST', `${DAY}/activities`, full);
    expect(res.status).toBe(201);
    expect(db.createActivity).toHaveBeenCalledWith(expect.anything(), 3, {
      ...full,
      lat: '35.6595',
      lng: '139.7005',
    });
  });

  it('PATCH can flip is_generic alone', async () => {
    const res = await send('PATCH', ACT, { is_generic: false });
    expect(res.status).toBe(200);
    expect(db.updateActivity).toHaveBeenCalledWith(expect.anything(), 4, { is_generic: false });
  });

  it('PATCH can clear time and maps_url with null', async () => {
    const res = await send('PATCH', ACT, { time: null, maps_url: null });
    expect(res.status).toBe(200);
    expect(db.updateActivity).toHaveBeenCalledWith(expect.anything(), 4, { time: null, maps_url: null });
  });

  it.each([
    ['javascript: maps_url', { maps_url: 'javascript:alert(1)' }, 'maps_url'],
    ['free-text time', { time: 'morning' }, 'time'],
  ])('POST rejects %s → 422', async (_label, extra, path) => {
    const res = await send('POST', `${DAY}/activities`, { name: 'x', ...extra });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorBody;
    expect(body.issues[0].path).toBe(path);
  });

  it('POST reports every invalid field at once', async () => {
    const res = await send('POST', `${DAY}/activities`, {
      name: '',
      lat: 'NaN',
      lng: 999,
      time: '25:00',
      maps_url: 'data:text/html,x',
      is_generic: 'yes',
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorBody;
    expect(body.issues.map((i) => i.path).sort()).toEqual(
      ['is_generic', 'lat', 'lng', 'maps_url', 'name', 'time'].sort(),
    );
  });

  it('PATCH destination zoom_level round-trips; out of range → 422 (BIZ-05)', async () => {
    expect((await send('PATCH', DEST, { zoom_level: 15 })).status).toBe(200);
    expect(db.updateDestination).toHaveBeenCalledWith(expect.anything(), 2, { zoom_level: 15 });
    for (const zoom_level of [0, 21, 12.5, '12']) {
      expect((await send('PATCH', DEST, { zoom_level })).status).toBe(422);
    }
  });
});
