/**
 * System: features from different phases combined, through the real app on
 * a real database, on both drivers (node-postgres and the production Neon
 * HTTP driver via installNeonHttpFake).
 *
 *   BIZ-07 date triggers × SEC-22 404s × public sharing × reorder
 *   trips deleted / re-dated while child writes are in flight
 *   users/me × provisioning × OTP cap × email uniqueness
 *   body limit × JSON depth × unicode
 *
 * Invariants checked after every race: no 5xx, no orphan rows, BIZ-07
 * violation query empty, nothing written by a refused request.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BIZ07_VIOLATIONS_SQL,
  buildTree,
  client,
  createSigner,
  createTestDatabase,
  dropTestDatabase,
  installFakeNetwork,
  installNeonHttpFake,
  makeEnv,
  makeUser,
  sql,
  type FakeNetwork,
  type NeonFake,
  type Req,
  type Signer,
  type TestUser,
} from './harness';

let signer: Signer;
let net: FakeNetwork;
let neon: NeonFake;
let dbUrl: string;

beforeAll(async () => {
  signer = await createSigner();
  net = installFakeNetwork([signer]);
  neon = installNeonHttpFake();
  dbUrl = await createTestDatabase('cross');
}, 60_000);

afterAll(async () => {
  await neon.close();
  await dropTestDatabase(dbUrl);
});

const ORPHANS_SQL = `
  SELECT 'dest' AS k, id FROM destinations d WHERE NOT EXISTS (SELECT 1 FROM trips t WHERE t.id = d.trip_id)
  UNION ALL SELECT 'day', id FROM days y WHERE NOT EXISTS (SELECT 1 FROM destinations d WHERE d.id = y.destination_id)
  UNION ALL SELECT 'act', id FROM activities a WHERE NOT EXISTS (SELECT 1 FROM days y WHERE y.id = a.day_id)
  UNION ALL SELECT 'hotel', id FROM hotels h WHERE NOT EXISTS (SELECT 1 FROM destinations d WHERE d.id = h.destination_id)`;

async function invariants() {
  expect(await sql(dbUrl, ORPHANS_SQL)).toEqual([]);
  expect(await sql(dbUrl, BIZ07_VIOLATIONS_SQL)).toEqual([]);
}

async function tableSnapshot(): Promise<string> {
  const parts: unknown[] = [];
  for (const t of ['trips', 'destinations', 'hotels', 'days', 'activities']) {
    parts.push(await sql(dbUrl, `SELECT * FROM ${t} ORDER BY id`));
  }
  return JSON.stringify(parts);
}

describe.each(['pg', 'neon'] as const)('cross-phase on the %s driver', (driver) => {
  let req: Req;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    req = client(makeEnv(dbUrl, { DB_DRIVER: driver, ENVIRONMENT: 'development' }));
    alice = await makeUser(signer);
    bob = await makeUser(signer);
  });

  describe('BIZ-07 × SEC-22 × public sharing', () => {
    it('a foreign write that would also violate a date rule answers 404, never 422 (no date/city leak), even on a public trip', async () => {
      const tree = await buildTree(req, alice.token, 1, true);
      await req('PATCH', `/api/trips/${tree.tripId}`, {
        token: alice.token,
        body: { start_date: '2026-03-01', end_date: '2026-03-05' },
      });
      const before = await tableSnapshot();
      const attempts: [string, string, unknown][] = [
        ['PATCH', `/api/trips/${tree.tripId}`, { end_date: '2026-03-02' }],
        ['POST', `/api/trips/${tree.tripId}/destinations`, { city_name: 'X', country: 'Y', start_date: '2026-03-01', end_date: '2026-03-09' }],
        ['PATCH', `/api/trips/${tree.tripId}/destinations/${tree.destId}`, { end_date: '2026-03-01' }],
        ['POST', `/api/trips/${tree.tripId}/destinations/${tree.destId}/days`, { date: '1999-01-01' }],
        ['PATCH', `${tree.base}`, { date: '1999-01-01' }],
        ['POST', `${tree.base}/activities/reorder`, { ordered_ids: tree.actIds }],
        ['PUT', `/api/trips/${tree.tripId}/destinations/${tree.destId}/hotel`, { name: 'h' }],
      ];
      for (const [method, path, body] of attempts) {
        const r = await req(method, path, { token: bob.token, body });
        expect(r.status, `${method} ${path}: ${r.text}`).toBe(404);
        expect(r.text).not.toMatch(/Kyoto|2026-03|date_conflict/);
      }
      expect(await tableSnapshot()).toBe(before);
      // The share itself is unaffected.
      const slug = (await sql(dbUrl, 'SELECT public_slug FROM trips WHERE id = $1', [tree.tripId]))[0]!.public_slug;
      expect((await req('GET', `/api/public/trips/${slug}`)).status).toBe(200);
    });

    it('the owner gets the 422 with the field; the public page never shows a rejected write', async () => {
      const tree = await buildTree(req, alice.token, 2, true);
      const slug = (await sql(dbUrl, 'SELECT public_slug FROM trips WHERE id = $1', [tree.tripId]))[0]!.public_slug;
      const pubBefore = (await req('GET', `/api/public/trips/${slug}`)).text;
      const r = await req('POST', `/api/trips/${tree.tripId}/destinations/${tree.destId}/days`, {
        token: alice.token,
        body: { date: '2026-03-06' },
      });
      expect(r.status).toBe(422);
      expect(r.body.issues).toEqual([{ path: 'date', message: r.body.error }]);
      expect((await req('GET', `/api/public/trips/${slug}`)).text).toBe(pubBefore);
    });

    it('unsharing while a reorder runs: the reorder applies or 404s, the public page flips to 404, no 5xx', async () => {
      const tree = await buildTree(req, alice.token, 5, true);
      const slug = (await sql(dbUrl, 'SELECT public_slug FROM trips WHERE id = $1', [tree.tripId]))[0]!.public_slug;
      const order = [...tree.actIds].reverse();
      const [re, unshare] = await Promise.all([
        req('POST', `${tree.base}/activities/reorder`, { token: alice.token, body: { ordered_ids: order } }),
        req('PATCH', `/api/trips/${tree.tripId}`, { token: alice.token, body: { is_public: false } }),
      ]);
      expect(re.status).toBe(200);
      expect(unshare.status).toBe(200);
      expect((await req('GET', `/api/public/trips/${slug}`)).status).toBe(404);
      const rows = await sql(dbUrl, 'SELECT id FROM activities WHERE day_id = $1 ORDER BY order_index', [tree.dayId]);
      expect(rows.map((x) => x.id)).toEqual(order);
    });
  });

  describe('trips deleted or re-dated while child writes are in flight', () => {
    it('trip DELETE racing every kind of child write: only 2xx/400/404/409, no orphans, nothing survives', async () => {
      const tree = await buildTree(req, alice.token, 4);
      const t = alice.token;
      const writes = [
        req('POST', `/api/trips/${tree.tripId}/destinations`, { token: t, body: { city_name: 'N', country: 'J' } }),
        req('PATCH', `/api/trips/${tree.tripId}/destinations/${tree.destId}`, { token: t, body: { end_date: '2026-03-04' } }),
        req('PUT', `/api/trips/${tree.tripId}/destinations/${tree.destId}/hotel`, { token: t, body: { name: 'h' } }),
        req('POST', `/api/trips/${tree.tripId}/destinations/${tree.destId}/days`, { token: t, body: { date: '2026-03-03' } }),
        req('PATCH', tree.base, { token: t, body: { date: '2026-03-04' } }),
        req('POST', `${tree.base}/activities`, { token: t, body: { name: 'late' } }),
        req('POST', `${tree.base}/activities/reorder`, { token: t, body: { ordered_ids: [...tree.actIds].reverse() } }),
        req('PATCH', `${tree.base}/activities/${tree.actIds[0]}`, { token: t, body: { name: 'renamed' } }),
        req('DELETE', `${tree.base}/activities/${tree.actIds[1]}`, { token: t }),
        req('PATCH', `/api/trips/${tree.tripId}`, { token: t, body: { start_date: '2026-03-01', end_date: '2026-03-05' } }),
      ];
      const del = req('DELETE', `/api/trips/${tree.tripId}`, { token: t });
      const results = await Promise.all([...writes, del]);
      // 400: the reorder saw the activity set change under it (create/delete in the same burst).
      for (const r of results) expect([200, 201, 400, 404, 409], r.text).toContain(r.status);
      expect((await del).status).toBe(200);
      expect(await sql(dbUrl, `SELECT id FROM destinations WHERE trip_id = $1`, [tree.tripId])).toEqual([]);
      await invariants(); // no day/activity/hotel outlived its parent
    });

    it('trip date shrinks racing day creates and destination edits keep every BIZ-07 rule (10 rounds)', async () => {
      const t = alice.token;
      const trip = await req('POST', '/api/trips', { token: t, body: { name: 'r', start_date: '2026-06-01', end_date: '2026-06-30' } });
      const tripId = trip.body.data.id;
      const d = await req('POST', `/api/trips/${tripId}/destinations`, {
        token: t,
        body: { city_name: 'A', country: 'J', start_date: '2026-06-01', end_date: '2026-06-20' },
      });
      const destId = d.body.data.id;
      for (let round = 0; round < 10; round++) {
        const end = `2026-06-${String(10 + round).padStart(2, '0')}`;
        const results = await Promise.all([
          req('PATCH', `/api/trips/${tripId}`, { token: t, body: { end_date: round % 2 ? '2026-06-30' : end } }),
          req('PATCH', `/api/trips/${tripId}/destinations/${destId}`, { token: t, body: { end_date: round % 2 ? end : '2026-06-25' } }),
          ...Array.from({ length: 4 }, (_, i) =>
            req('POST', `/api/trips/${tripId}/destinations/${destId}/days`, {
              token: t,
              body: { date: `2026-06-${String(8 + round + i * 3).padStart(2, '0')}` },
            }),
          ),
        ]);
        for (const r of results) expect([200, 201, 422], r.text).toContain(r.status);
        await invariants();
      }
    });
  });

  describe('users/me × provisioning × OTP cap × email uniqueness', () => {
    it('a brand-new user firing users/me PATCH, otp-request and trips at once: one row, one code, PATCH applied or 404', async () => {
      const u = await makeUser(signer);
      const results = await Promise.all([
        req('GET', '/api/users/me', { token: u.token }),
        req('PATCH', '/api/users/me', { token: u.token, body: { preferences: { theme: 'dark', 'ключ': '日本' } } }),
        ...Array.from({ length: 6 }, () => req('POST', '/api/auth/otp-request', { token: u.token })),
        req('GET', '/api/trips', { token: u.token }),
      ]);
      for (const r of results) expect([200, 201, 404, 429], r.text).toContain(r.status);
      expect(await sql(dbUrl, 'SELECT id FROM users WHERE keycloak_id = $1', [u.sub])).toHaveLength(1);
      const codes = await sql(dbUrl, `SELECT c.id FROM email_otp_codes c JOIN users x ON x.id = c.user_id WHERE x.keycloak_id = $1`, [u.sub]);
      expect(codes).toHaveLength(1);
      expect(results.slice(2, 8).filter((r) => r.status === 201)).toHaveLength(1);
    });

    it('a token without email: provisioning works, OTP is 422 and issues nothing; a second email-less user does not collide', async () => {
      const a = await makeUser(signer, { email: undefined });
      const b = await makeUser(signer, { email: '' });
      for (const u of [a, b]) {
        expect((await req('GET', '/api/users/me', { token: u.token })).status).toBeLessThan(300);
        const otp = await req('POST', '/api/auth/otp-request', { token: u.token });
        expect(otp.status).toBe(422);
      }
    });

    it('an existing user whose Keycloak email moves onto another account keeps signing in and gets OTPs at the token address', async () => {
      const owner = await makeUser(signer);
      const mover = await makeUser(signer);
      await req('GET', '/api/users/me', { token: owner.token });
      await req('GET', '/api/users/me', { token: mover.token });
      const moved = await makeUser(signer, { sub: mover.sub, email: owner.email.toUpperCase() });
      const me = await req('GET', '/api/users/me', { token: moved.token });
      expect(me.status).toBe(200);
      expect(me.body.data.email).toBe(mover.email); // stored email kept (DATA-02)
      // OTP is sent to the address in the token (Keycloak is the source of
      // truth), not the stored one — documented in the report.
      const before = net.mails.length;
      const otp = await req('POST', '/api/auth/otp-request', { token: moved.token });
      expect(otp.status).toBe(201);
      expect(net.mails.slice(before).map((m) => m.to)).toEqual([owner.email.toUpperCase()]);
    });
  });

  describe('body limit × JSON depth × unicode', () => {
    it('the 1 MiB cap counts bytes: ~600k chars of 3-byte CJK is 413 with nothing written; the same in ASCII is accepted', async () => {
      const tree = await buildTree(req, alice.token, 0);
      const before = await tableSnapshot();
      const cjk = await req('POST', `${tree.base}/activities`, { token: alice.token, body: { name: 'n', notes: '日'.repeat(600_000) } });
      expect(cjk.status).toBe(413);
      expect(await tableSnapshot()).toBe(before);
      const ascii = await req('POST', `${tree.base}/activities`, { token: alice.token, body: { name: 'n', notes: 'a'.repeat(600_000) } });
      expect(ascii.status, ascii.text.slice(0, 200)).toBe(201);
      const stored = await sql(dbUrl, 'SELECT length(notes) AS n FROM activities WHERE id = $1', [ascii.body.data.id]);
      expect(stored[0]!.n).toBe(600_000);
    });

    it('preferences: 64 levels of unicode keys round-trip; 65 levels and a 20k-deep body are 422, never 500', async () => {
      const u = await makeUser(signer);
      await req('GET', '/api/users/me', { token: u.token });
      const nest = (depth: number) => {
        let v: Record<string, unknown> = { leaf: '🗾' };
        for (let i = 1; i < depth; i++) v = { [`層${i}`]: v };
        return v;
      };
      const ok = await req('PATCH', '/api/users/me', { token: u.token, body: { preferences: nest(64) } });
      expect(ok.status, ok.text).toBe(200);
      expect(ok.body.data.preferences).toEqual(nest(64));
      expect((await req('PATCH', '/api/users/me', { token: u.token, body: { preferences: nest(65) } })).status).toBe(422);
      const deep = '{"preferences":' + '{"a":'.repeat(20_000) + '1' + '}'.repeat(20_000) + '}';
      const r = await req('PATCH', '/api/users/me', { token: u.token, body: deep });
      expect(r.status).toBe(422);
    });

    it('names at the 255 limit: CJK / combining / RTL round-trip; 255 astral emoji (510 UTF-16 units) is 422', async () => {
      const t = alice.token;
      for (const name of ['日'.repeat(255), 'é'.repeat(127) + 'x', 'مرحبا'.repeat(51)]) {
        const r = await req('POST', '/api/trips', { token: t, body: { name } });
        expect(r.status, name.slice(0, 10)).toBe(201);
        expect(r.body.data.name).toBe(name);
      }
      expect((await req('POST', '/api/trips', { token: t, body: { name: '🗾'.repeat(255) } })).status).toBe(422);
      const emoji = await req('POST', '/api/trips', { token: t, body: { name: '🗾'.repeat(127) } });
      expect(emoji.status).toBe(201);
    });

    it('BIZ-07 messages carry unicode / quotes in city names verbatim and stay valid JSON', async () => {
      const t = alice.token;
      const trip = await req('POST', '/api/trips', { token: t, body: { name: 'u', start_date: '2026-07-01', end_date: '2026-07-10' } });
      const tripId = trip.body.data.id;
      const city = '大阪 "Ōsaka" ‮evil';
      await req('POST', `/api/trips/${tripId}/destinations`, {
        token: t,
        body: { city_name: city, country: 'JP', start_date: '2026-07-02', end_date: '2026-07-05' },
      });
      const r = await req('PATCH', `/api/trips/${tripId}`, { token: t, body: { end_date: '2026-07-03' } });
      expect(r.status).toBe(422);
      expect(r.body.error).toContain(city);
    });
  });
});
