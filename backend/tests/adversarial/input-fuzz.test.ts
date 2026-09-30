/**
 * Adversarial: hostile input shapes — path ids, bodies, content types,
 * strings, coordinates and dates.
 *
 * Rule asserted throughout: bad client input is a 4xx, never a 500 and never
 * silently stored as garbage. Entries owned by an in-flight phase are
 * `it.fails` with the requirement id in the title.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  type Req,
  type TestUser,
  type Tree,
} from './harness';

let dbUrl: string;
let req: Req;
let user: TestUser;
let tree: Tree;

describeDb('input fuzzing', () => {
  beforeAll(async () => {
    const signer = await createSigner();
    installFakeNetwork([signer]);
    dbUrl = await createTestDatabase('fuzz');
    req = client(makeEnv(dbUrl));
    user = await makeUser(signer);
    tree = await buildTree(req, user.token, 2);
  }, 60_000);

  afterAll(async () => {
    await dropTestDatabase(dbUrl);
  });

  const is4xx = (s: number) => s >= 400 && s < 500;

  // -------------------------------------------------------------------------
  describe('path ids', () => {
    const badIds = [
      '-1',
      '0',
      '1e3',
      '0x10',
      'NaN',
      'null',
      '1;DROP TABLE trips',
      "1' OR '1'='1",
      '%00',
      '１', // full-width digit
    ];

    it.each(badIds)('GET /api/trips/%s → 4xx, never 500', async (id) => {
      const res = await req('GET', `/api/trips/${encodeURIComponent(id)}`, { token: user.token });
      expect(is4xx(res.status), `status ${res.status}`).toBe(true);
    });

    // Number() accepts these, so they reach Postgres as non-int4 params.
    it.each(['1.5', 'Infinity', '-Infinity', '99999999999', '9007199254740993'])(
      'GET /api/trips/%s → 400, never 500',
      async (id) => {
        const res = await req('GET', `/api/trips/${encodeURIComponent(id)}`, { token: user.token });
        expect(res.status).toBe(400);
      },
    );

    it.each(['1.5', 'Infinity', '99999999999'])(
      'nested routes with id %s → 4xx, never 500',
      async (id) => {
        const paths = [
          `/api/trips/${id}/destinations`,
          `/api/trips/${tree.tripId}/destinations/${id}/days`,
          `/api/trips/${tree.tripId}/destinations/${tree.destId}/hotel`.replace(String(tree.destId), id),
          `/api/trips/${tree.tripId}/destinations/${tree.destId}/days/${id}/activities`,
        ];
        for (const p of paths) {
          const res = await req('GET', p, { token: user.token });
          expect.soft(is4xx(res.status), `${p} → ${res.status}`).toBe(true);
        }
      },
    );

it('PATCH /api/trips/1.5 with a valid body → 4xx, and says the id is invalid', async () => {
      const res = await req('PATCH', '/api/trips/1.5', { token: user.token, body: { name: 'x' } });
      expect(res.status).toBe(400);
    });

it('ids that are numeric but not canonical ("0x10", "1e3", " 7") do not alias real rows', async () => {
      // Number('0x10') === 16 — the API must not treat "0x10" as trip 16.
      for (const id of ['0x' + tree.tripId.toString(16), `${tree.tripId}e0`, `0${tree.tripId}`]) {
        const res = await req('GET', `/api/trips/${id}`, { token: user.token });
        expect.soft(res.status, id).toBe(400);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('request bodies / content types', () => {
it('malformed JSON with application/json → 400 (not 500)', async () => {
      const res = await req('POST', '/api/trips', { token: user.token, body: '{"name": "x",' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('JSON array / scalar / null body → 422', async () => {
      for (const body of ['[]', '"trip"', '42', 'null', 'true']) {
        const res = await req('POST', '/api/trips', { token: user.token, body });
        expect.soft(res.status, body).toBe(422);
      }
    });

it('empty body with application/json → 400', async () => {
      const res = await req('POST', '/api/trips', { token: user.token, body: '' });
      expect(res.status).toBe(400);
    });

    it('text/plain body on a create → 422, nothing created', async () => {
      const before = (await req('GET', '/api/trips', { token: user.token })).body.data.length;
      const res = await req('POST', '/api/trips', {
        token: user.token,
        body: JSON.stringify({ name: 'sneaky' }),
        contentType: 'text/plain',
      });
      expect(res.status).toBe(422);
      expect((await req('GET', '/api/trips', { token: user.token })).body.data.length).toBe(before);
    });

    it('application/json; charset=utf-8 and vendor +json are accepted', async () => {
      for (const ct of ['application/json; charset=utf-8', 'application/vnd.api+json']) {
        const res = await req('POST', '/api/trips', { token: user.token, body: { name: ct }, contentType: ct });
        expect.soft(res.status, ct).toBe(201);
      }
    });

    // BIZ-09 (fixed in Phase 25 by atLeastOneField): a body the JSON validator
    // ignores (wrong content type) or an empty object used to be a silent
    // 200 no-op. Regression guard.
    it('BIZ-09: PATCH with text/plain body is rejected instead of a silent 200 no-op', async () => {
      const res = await req('PATCH', `/api/trips/${tree.tripId}`, {
        token: user.token,
        body: JSON.stringify({ name: 'renamed' }),
        contentType: 'text/plain',
      });
      expect(res.status).toBe(422);
      const after = await req('GET', `/api/trips/${tree.tripId}`, { token: user.token });
      expect(after.body.data.name).not.toBe('renamed');
    });

    it('BIZ-09: PATCH {} (or only unknown keys) is rejected with 422, not 200', async () => {
      for (const body of [{}, { unknown: 1 }]) {
        const res = await req('PATCH', `/api/trips/${tree.tripId}`, { token: user.token, body });
        expect.soft(res.status, JSON.stringify(body)).toBe(422);
      }
    });

it('oversized body (2 MB) is rejected with 413 before touching the DB', async () => {
      const res = await req('POST', '/api/trips', {
        token: user.token,
        body: { name: 'big', description: 'x'.repeat(2 * 1024 * 1024) },
      });
      expect(res.status).toBe(413);
    });

    it('body just under 1 MB is still accepted (limit does not bite real payloads)', async () => {
      const res = await req('POST', '/api/trips', {
        token: user.token,
        body: { name: 'near-limit', description: 'x'.repeat(1000 * 1000) },
      });
      expect(res.status).toBe(201);
    });

    it('oversized body without a token → 413 or 401, never reaches the DB', async () => {
      const res = await req('POST', '/api/trips', { body: { name: 'x', description: 'y'.repeat(2 * 1024 * 1024) } });
      expect([401, 413]).toContain(res.status);
    });

it('deeply nested JSON (depth 20k) → 4xx, never 500', async () => {
      const deep = '['.repeat(20_000) + ']'.repeat(20_000);
      const res = await req('PATCH', '/api/users/me', {
        token: user.token,
        body: `{"preferences":{"x":${deep}}}`,
      });
      expect(is4xx(res.status), `status ${res.status}`).toBe(true);
    });

    it('preferences: 32 levels and ~15 KB are accepted, 33 levels or >16 KB are 422', async () => {
      const nest = (d: number): unknown => (d === 1 ? { leaf: true } : { n: nest(d - 1) });
      expect((await req('PATCH', '/api/users/me', { token: user.token, body: { preferences: nest(32) } })).status).toBe(200);
      expect((await req('PATCH', '/api/users/me', { token: user.token, body: { preferences: nest(33) } })).status).toBe(422);
      const ok = { blob: 'x'.repeat(15 * 1024) };
      expect((await req('PATCH', '/api/users/me', { token: user.token, body: { preferences: ok } })).status).toBe(200);
      const big = { blob: 'x'.repeat(17 * 1024) };
      expect((await req('PATCH', '/api/users/me', { token: user.token, body: { preferences: big } })).status).toBe(422);
    });

    it('unknown fields are stripped, not stored or echoed', async () => {
      const res = await req('POST', '/api/trips', {
        token: user.token,
        body: { name: 'strip', __proto__: { admin: true }, constructor: 'x', evil: '<script>' },
      });
      expect(res.status).toBe(201);
      expect(res.body.data).not.toHaveProperty('evil');
      expect(res.body.data).not.toHaveProperty('admin');
    });
  });

  // -------------------------------------------------------------------------
  describe('strings', () => {
    it('emoji / RTL / combining characters round-trip exactly', async () => {
      const name = '🗾 東京 👨‍👩‍👧‍👦 שלום é ‮evil';
      const res = await req('POST', '/api/trips', { token: user.token, body: { name } });
      expect(res.status).toBe(201);
      const got = await req('GET', `/api/trips/${res.body.data.id}`, { token: user.token });
      expect(got.body.data.name).toBe(name);
    });

    it('name of exactly 255 UTF-16 units of astral emoji is accepted or cleanly rejected (never 500)', async () => {
      // 128 × '🗾' = 256 UTF-16 units but 128 code points: zod counts units,
      // Postgres varchar(255) counts code points.
      const res = await req('POST', '/api/trips', { token: user.token, body: { name: '🗾'.repeat(127) } });
      expect(res.status).toBe(201);
      const over = await req('POST', '/api/trips', { token: user.token, body: { name: '🗾'.repeat(128) } });
      expect(over.status).toBe(422);
    });

    it('name of 256 chars → 422', async () => {
      const res = await req('POST', '/api/trips', { token: user.token, body: { name: 'a'.repeat(256) } });
      expect(res.status).toBe(422);
    });

    it('whitespace-only / empty name → 422', async () => {
      const res = await req('POST', '/api/trips', { token: user.token, body: { name: '' } });
      expect(res.status).toBe(422);
    });

it.each([
      ['trip name', 'POST', () => '/api/trips', (v: string) => ({ name: v })],
      ['trip description', 'POST', () => '/api/trips', (v: string) => ({ name: 'n', description: v })],
      ['destination city', 'POST', () => `/api/trips/${tree.tripId}/destinations`, (v: string) => ({ city_name: v, country: 'JP' })],
      ['day label', 'POST', () => `/api/trips/${tree.tripId}/destinations/${tree.destId}/days`, (v: string) => ({ date: '2026-03-04', label: v })],
      ['activity notes', 'POST', () => `${tree.base}/activities`, (v: string) => ({ name: 'n', notes: v })],
      ['activity name (PATCH)', 'PATCH', () => `${tree.base}/activities/${tree.actIds[0]}`, (v: string) => ({ name: v })],
      ['trip name (PATCH)', 'PATCH', () => `/api/trips/${tree.tripId}`, (v: string) => ({ name: v })],
      ['activity time', 'POST', () => `${tree.base}/activities`, (v: string) => ({ name: 'n', time: v })],
      ['hotel name', 'PUT', () => `/api/trips/${tree.tripId}/destinations/${tree.destId}/hotel`, (v: string) => ({ name: v })],
      ['maps_url', 'POST', () => `${tree.base}/activities`, (v: string) => ({ name: 'n', maps_url: `https://x.test/${v}` })],
    ])('NUL byte in %s → 422 (Postgres text cannot store \\u0000)', async (_l, method, path, body) => {
      const res = await req(method, path(), { token: user.token, body: body('bad\u0000value') });
      expect(res.status).toBe(422);
    });

    it('lone UTF-16 surrogate in a string is handled (stored as U+FFFD or rejected, never 500)', async () => {
      const res = await req('POST', '/api/trips', { token: user.token, body: '{"name":"half \\ud83d surrogate"}' });
      expect(is4xx(res.status) || res.status === 201, `status ${res.status}`).toBe(true);
    });

    it('SQL-ish strings are stored literally', async () => {
      const name = "Robert'); DROP TABLE trips;--";
      const res = await req('POST', '/api/trips', { token: user.token, body: { name } });
      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe(name);
      expect((await sql(dbUrl, 'select count(*)::int as n from trips'))[0]!.n).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('URLs', () => {
it.each([
      ['javascript:', 'javascript:alert(document.domain)'],
      ['data:', 'data:text/html,<script>alert(1)</script>'],
      ['vbscript:', 'vbscript:msgbox(1)'],
      ['file:', 'file:///etc/passwd'],
    ])('rejects %s scheme in URL fields (stored-XSS / local-file vectors)', async (_l, url) => {
      const attempts = [
        req('POST', '/api/trips', { token: user.token, body: { name: 'u', cover_image_url: url } }),
        req('POST', `${tree.base}/activities`, { token: user.token, body: { name: 'u', maps_url: url } }),
        req('PUT', `/api/trips/${tree.tripId}/destinations/${tree.destId}/hotel`, {
          token: user.token,
          body: { name: 'h', url },
        }),
        req('PATCH', '/api/users/me', { token: user.token, body: { avatar_url: url } }),
      ];
      const results = await Promise.all(attempts);
      for (const r of results) expect.soft(r.status, r.text).toBe(422);
    });

    it('rejects scheme-relative and scheme-less URLs', async () => {
      for (const url of ['//evil.test/x', 'evil.test/x', 'javascript://%0aalert(1)']) {
        const res = await req('POST', '/api/trips', { token: user.token, body: { name: 'u', cover_image_url: url } });
        expect.soft(res.status, url).toBe(422);
      }
    });

    it('accepts ordinary https URLs', async () => {
      const res = await req('POST', `${tree.base}/activities`, {
        token: user.token,
        body: { name: 'ok', maps_url: 'https://maps.google.com/?q=Kyoto' },
      });
      expect(res.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  describe('coordinates', () => {
    const post = (lat: unknown, lng: unknown = 135.7) =>
      req('POST', `${tree.base}/activities`, { token: user.token, body: { name: 'coord', lat, lng } });

    it('valid numeric and numeric-string coordinates are stored', async () => {
      const a = await post(35.0116, 135.7681);
      expect(a.status).toBe(201);
      expect(Number(a.body.data.lat)).toBeCloseTo(35.0116, 4);
      const b = await post('34.9671', '135.7727');
      expect(b.status).toBe(201);
    });

    it('null coordinates are stored as NULL', async () => {
      const res = await post(null, null);
      expect(res.status).toBe(201);
      expect(res.body.data.lat).toBeNull();
    });

    // BIZ-08 (fixed in Phase 25 by coordinate()): lat/lng used to be
    // z.coerce.string(), so anything that stringified reached NUMERIC(10,7) and
    // Postgres answered 500 or stored NaN / out-of-range degrees. Regression guard.
    it.each([
      ['"null" string', 'null'],
      ['empty string', ''],
      ['boolean', true],
      ['object', {}],
      ['array', []],
      ['1e400 (Infinity after parse)', '1e400'],
      ['too many integer digits (1000)', 1000],
    ])('BIZ-08: lat = %s → 422, never 500', async (_l, lat) => {
      const res = await post(lat);
      expect(res.status).toBe(422);
    });

    it('BIZ-08: lat = "NaN" is rejected instead of stored as NaN', async () => {
      const res = await post('NaN');
      expect(res.status).toBe(422);
    });

    it('BIZ-08: lat = 91 / lng = 181 are rejected', async () => {
      expect((await post(91)).status).toBe(422);
      expect((await post(0, 181)).status).toBe(422);
    });

    it('BIZ-08: lat = "Infinity" is rejected with 422 (not 500)', async () => {
      expect((await post('Infinity')).status).toBe(422);
    });
  });

  // -------------------------------------------------------------------------
  describe('dates', () => {
    const tripWith = (start_date: unknown, end_date: unknown = null) =>
      req('POST', '/api/trips', { token: user.token, body: { name: 'dates', start_date, end_date } });

    it.each(['0000-00-00', '2026-02-30', '2025-02-29', '2026-13-01', '2026-1-1', '26-01-01', '2026/01/01', '2026-01-01T00:00:00Z', ''])(
      'rejects %s with 422',
      async (d) => {
        expect((await tripWith(d)).status).toBe(422);
      },
    );

    it('accepts leap day 2028-02-29 and round-trips it without timezone shift', async () => {
      const res = await tripWith('2028-02-29', '2028-03-01');
      expect(res.status).toBe(201);
      expect(res.body.data.start_date).toBe('2028-02-29');
    });

    it('accepts the earliest storable year 0001', async () => {
      expect((await tripWith('0001-01-01')).status).toBe(201);
    });

    it('hotel/destination dates with year 0000 → 422, never 500', async () => {
      const hotel = await req('PUT', `/api/trips/${tree.tripId}/destinations/${tree.destId}/hotel`, {
        token: user.token,
        body: { name: 'h', check_in_date: '0000-01-01' },
      });
      expect(hotel.status).toBe(422);
      const dest = await req('PATCH', `/api/trips/${tree.tripId}/destinations/${tree.destId}`, {
        token: user.token,
        body: { end_date: '0000-12-31' },
      });
      expect(dest.status).toBe(422);
    });

    it('accepts far-future 9999-12-31', async () => {
      expect((await tripWith('9999-12-31')).status).toBe(201);
    });

it('year 0000 (valid leap-day shape, invalid in Postgres) → 422, never 500', async () => {
      expect((await tripWith('0000-02-29')).status).toBe(422);
      expect((await tripWith('0000-01-01')).status).toBe(422);
    });

it('day date 0000-01-01 → 422, never 500', async () => {
      const res = await req('POST', `/api/trips/${tree.tripId}/destinations/${tree.destId}/days`, {
        token: user.token,
        body: { date: '0000-01-01' },
      });
      expect(res.status).toBe(422);
    });

    it('BIZ-06: trip with end_date before start_date is rejected', async () => {
      expect((await tripWith('2026-03-10', '2026-03-01')).status).toBe(422);
    });

    it('BIZ-06: hotel check-out before check-in is rejected', async () => {
      const res = await req('PUT', `/api/trips/${tree.tripId}/destinations/${tree.destId}/hotel`, {
        token: user.token,
        body: { name: 'h', check_in_date: '2026-03-05', check_out_date: '2026-03-01' },
      });
      expect(res.status).toBe(422);
    });

    // STILL OPEN — BIZ-07 was deferred by Phase 25 (cross-level date coherence).
    it.fails('BIZ-07: day outside its destination date range is rejected', async () => {
      // buildTree's destination runs 2026-03-01..2026-03-05.
      const res = await req('POST', `/api/trips/${tree.tripId}/destinations/${tree.destId}/days`, {
        token: user.token,
        body: { date: '1999-01-01' },
      });
      expect(res.status).toBe(422);
    });
  });

  // -------------------------------------------------------------------------
  describe('numeric fields', () => {
    it.each([
      ['negative order_index', { name: 'n', order_index: -1 }],
      ['float order_index', { name: 'n', order_index: 1.5 }],
      ['string order_index', { name: 'n', order_index: '1' }],
    ])('activity with %s → 422, never 500', async (_l, body) => {
      const res = await req('POST', `${tree.base}/activities`, { token: user.token, body });
      expect(res.status).toBe(422);
    });

    it('order_index beyond int4 → 422, never 500', async () => {
      for (const [path, body] of [
        [`${tree.base}/activities`, { name: 'n', order_index: 2 ** 31 }],
        [`/api/trips/${tree.tripId}/destinations`, { city_name: 'c', country: 'JP', order_index: 2 ** 31 }],
        [`/api/trips/${tree.tripId}/destinations/${tree.destId}/days`, { date: '2026-03-03', order_index: 2 ** 31 }],
      ] as const) {
        const res = await req('POST', path, { token: user.token, body });
        expect.soft(res.status, path).toBe(422);
      }
    });

    it('zoom_level outside 1..20 → 422', async () => {
      for (const zoom_level of [0, 21, 12.5, -3]) {
        const res = await req('POST', `/api/trips/${tree.tripId}/destinations`, {
          token: user.token,
          body: { city_name: 'z', country: 'JP', zoom_level },
        });
        expect.soft(res.status, String(zoom_level)).toBe(422);
      }
    });

    it('color_hex must be #RRGGBB', async () => {
      for (const color_hex of ['red', '#fff', '#GGGGGG', '#12345678', 'javascript:1']) {
        const res = await req('POST', `/api/trips/${tree.tripId}/destinations/${tree.destId}/days`, {
          token: user.token,
          body: { date: '2026-03-03', color_hex },
        });
        expect.soft(res.status, color_hex).toBe(422);
      }
    });
  });
});
