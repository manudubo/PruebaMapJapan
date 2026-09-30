/**
 * Adversarial: full use-case flows and their combinations —
 * create → nest → hotel → reorder → share publicly → unshare → delete
 * (cascades), double-submit, re-use of deleted ids, and /api/users/me.
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
  type Signer,
  type TestUser,
} from './harness';

let dbUrl: string;
let req: Req;
let signer: Signer;
let user: TestUser;

async function count(table: string): Promise<number> {
  return (await sql<{ n: number }>(dbUrl, `select count(*)::int as n from ${table}`))[0]!.n;
}

describeDb('flows', () => {
  beforeAll(async () => {
    signer = await createSigner();
    installFakeNetwork([signer]);
    dbUrl = await createTestDatabase('flows');
    req = client(makeEnv(dbUrl));
    user = await makeUser(signer);
  }, 60_000);

  afterAll(async () => {
    await dropTestDatabase(dbUrl);
  });

  describe('create → nest → share → unshare → delete', () => {
    it('full lifecycle with cascades and public visibility at each step', async () => {
      const t = await buildTree(req, user.token, 3);
      const trip = t.tripId;
      const dest = `/api/trips/${trip}/destinations/${t.destId}`;

      // hotel: create, replace (PUT is idempotent-replace), read back
      expect((await req('PUT', `${dest}/hotel`, { token: user.token, body: { name: 'H1' } })).status).toBe(200);
      const h2 = await req('PUT', `${dest}/hotel`, { token: user.token, body: { name: 'H2', url: 'https://h2.test' } });
      expect(h2.status).toBe(200);
      const hotelGet = await req('GET', `${dest}/hotel`, { token: user.token });
      expect(hotelGet.body.data.name).toBe('H2');
      expect((await sql(dbUrl, 'select * from hotels where destination_id=$1', [t.destId])).length).toBe(1);

      // nested read is ordered and complete
      const full = await req('GET', `/api/trips/${trip}`, { token: user.token });
      expect(full.body.data.destinations[0].hotel.name).toBe('H2');
      expect(full.body.data.destinations[0].days[0].activities.map((a: { name: string }) => a.name)).toEqual([
        'Act 0',
        'Act 1',
        'Act 2',
      ]);

      // private trip is not visible by slug
      const slug = full.body.data.public_slug as string;
      expect((await req('GET', `/api/public/trips/${slug}`)).status).toBe(404);

      // share
      expect((await req('PATCH', `/api/trips/${trip}`, { token: user.token, body: { is_public: true } })).status).toBe(200);
      const pub = await req('GET', `/api/public/trips/${slug}`);
      expect(pub.status).toBe(200);
      expect(pub.body.data.destinations[0].days[0].activities).toHaveLength(3);
      // owner identity (email / keycloak id / name) never leaks in the public payload
      expect(pub.text).not.toContain(user.email);
      expect(pub.text).not.toContain(user.sub);

      // slug is stable across edits and case-insensitive
      await req('PATCH', `/api/trips/${trip}`, { token: user.token, body: { name: 'renamed' } });
      expect((await req('GET', `/api/public/trips/${slug.toUpperCase()}`)).status).toBe(200);

      // unshare → gone immediately
      await req('PATCH', `/api/trips/${trip}`, { token: user.token, body: { is_public: false } });
      expect((await req('GET', `/api/public/trips/${slug}`)).status).toBe(404);

      // delete the day → its activities are gone
      expect((await req('DELETE', t.base, { token: user.token })).status).toBe(200);
      expect((await sql(dbUrl, 'select 1 from activities where day_id=$1', [t.dayId])).length).toBe(0);

      // delete the trip → everything under it is gone
      expect((await req('DELETE', `/api/trips/${trip}`, { token: user.token })).status).toBe(200);
      expect((await sql(dbUrl, 'select 1 from destinations where trip_id=$1', [trip])).length).toBe(0);
      expect((await sql(dbUrl, 'select 1 from hotels where destination_id=$1', [t.destId])).length).toBe(0);

      // every route on the deleted trip is a clean 404 (or 403/404), never 500
      for (const [m, p] of [
        ['GET', `/api/trips/${trip}`],
        ['PATCH', `/api/trips/${trip}`],
        ['DELETE', `/api/trips/${trip}`],
        ['GET', `/api/trips/${trip}/destinations`],
        ['GET', `${dest}/hotel`],
        ['GET', `${t.base}/activities`],
        ['POST', `${t.base}/activities/reorder`],
      ] as const) {
        const res = await req(m, p, {
          token: user.token,
          body: m === 'PATCH' ? { name: 'x' } : m === 'POST' ? { ordered_ids: [] } : undefined,
        });
        expect.soft(res.status, `${m} ${p}`).toBe(404);
      }
      expect((await req('GET', `/api/public/trips/${slug}`)).status).toBe(404);
    });

    it('deleting a destination cascades to hotel, days and activities only for that destination', async () => {
      const t = await buildTree(req, user.token, 2);
      const sibling = await req('POST', `/api/trips/${t.tripId}/destinations`, {
        token: user.token,
        body: { city_name: 'Osaka', country: 'Japan' },
      });
      await req('PUT', `/api/trips/${t.tripId}/destinations/${t.destId}/hotel`, { token: user.token, body: { name: 'H' } });
      const res = await req('DELETE', `/api/trips/${t.tripId}/destinations/${t.destId}`, { token: user.token });
      expect(res.status).toBe(200);
      expect((await sql(dbUrl, 'select 1 from days where destination_id=$1', [t.destId])).length).toBe(0);
      expect((await sql(dbUrl, 'select 1 from activities where id = any($1)', [t.actIds])).length).toBe(0);
      expect((await sql(dbUrl, 'select 1 from hotels where destination_id=$1', [t.destId])).length).toBe(0);
      expect((await sql(dbUrl, 'select 1 from destinations where id=$1', [sibling.body.data.id])).length).toBe(1);
    });

    it('DELETE hotel when none exists is idempotent (200), GET hotel then 404', async () => {
      const t = await buildTree(req, user.token, 0);
      const p = `/api/trips/${t.tripId}/destinations/${t.destId}/hotel`;
      expect((await req('DELETE', p, { token: user.token })).status).toBe(200);
      expect((await req('GET', p, { token: user.token })).status).toBe(404);
    });

    it('deleting the same activity twice → 200 then 404', async () => {
      const t = await buildTree(req, user.token, 1);
      const p = `${t.base}/activities/${t.actIds[0]}`;
      expect((await req('DELETE', p, { token: user.token })).status).toBe(200);
      expect((await req('DELETE', p, { token: user.token })).status).toBe(404);
      expect((await req('PATCH', p, { token: user.token, body: { name: 'ghost' } })).status).toBe(404);
    });
  });

  describe('double submit', () => {
    it('two identical POST /api/trips create two distinct trips (no idempotency key — documented behaviour)', async () => {
      const body = { name: 'double' };
      const [a, b] = await Promise.all([
        req('POST', '/api/trips', { token: user.token, body }),
        req('POST', '/api/trips', { token: user.token, body }),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.data.id).not.toBe(b.body.data.id);
      expect(a.body.data.public_slug).not.toBe(b.body.data.public_slug);
    });

    it('double DELETE of a trip in parallel → no 500, trip gone', async () => {
      const t = await buildTree(req, user.token, 1);
      const results = await Promise.all([
        req('DELETE', `/api/trips/${t.tripId}`, { token: user.token }),
        req('DELETE', `/api/trips/${t.tripId}`, { token: user.token }),
      ]);
      for (const r of results) expect([200, 404]).toContain(r.status);
      expect((await sql(dbUrl, 'select 1 from trips where id=$1', [t.tripId])).length).toBe(0);
    });
  });

  describe('public slug edge cases', () => {
    let slug: string;
    beforeAll(async () => {
      const t = await buildTree(req, user.token, 1, true);
      slug = (await sql<{ public_slug: string }>(dbUrl, 'select public_slug from trips where id=$1', [t.tripId]))[0]!
        .public_slug;
    });

    it('canonical and upper-case slug → 200', async () => {
      expect((await req('GET', `/api/public/trips/${slug}`)).status).toBe(200);
      expect((await req('GET', `/api/public/trips/${slug.toUpperCase()}`)).status).toBe(200);
    });

    it.each([
      ['near-UUID (one hex char short)', () => slug.slice(0, -1)],
      ['near-UUID (one extra char)', () => `${slug}0`],
      ['braced', () => `{${slug}}`],
      ['no dashes', () => slug.replace(/-/g, '')],
      ['urn prefix', () => `urn:uuid:${slug}`],
      ['trailing newline', () => `${slug}\n`],
      ['trailing space', () => `${slug} `],
      ['SQL-ish', () => `${slug.slice(0, 30)}' OR 1=1--`],
      ['unicode look-alike digits', () => slug.replace(/[0-9]/, '٠')],
      ['full-width hex', () => slug.replace(/[a-f]/, 'ａ')],
      ['numeric trip id', () => '1'],
      ['all zeros', () => '00000000-0000-0000-0000-000000000000'],
    ])('%s → 400 or 404, never 200/500', async (_l, s) => {
      const res = await req('GET', `/api/public/trips/${encodeURIComponent(s())}`);
      expect([400, 404]).toContain(res.status);
    });

    it('valid-shape but non-existent UUID → 404', async () => {
      expect((await req('GET', '/api/public/trips/123e4567-e89b-42d3-a456-426614174000')).status).toBe(404);
    });

    it('public route ignores Authorization entirely (bad token still gets the public trip)', async () => {
      const res = await req('GET', `/api/public/trips/${slug}`, { headers: { Authorization: 'Bearer garbage' } });
      expect(res.status).toBe(200);
    });

    it('write methods on the public route are not allowed', async () => {
      for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const res = await req(m, `/api/public/trips/${slug}`, { body: { is_public: false } });
        expect.soft(res.status, m).toBe(404);
      }
      expect((await req('GET', `/api/public/trips/${slug}`)).status).toBe(200);
    });

    // SEC-21 (fixed in Phase 26): the public payload used to carry the owner's user_id.
    it('SEC-21: public payload does not expose the owner\'s internal user_id', async () => {
      const res = await req('GET', `/api/public/trips/${slug}`);
      expect(res.body.data).not.toHaveProperty('user_id');
    });
  });

  describe('/api/users/me', () => {
    it('first GET provisions (201), second GET returns the same row (200)', async () => {
      const u = await makeUser(signer);
      const first = await req('GET', '/api/users/me', { token: u.token });
      const second = await req('GET', '/api/users/me', { token: u.token });
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.data.id).toBe(first.body.data.id);
    });

    it('PATCH before any other call (user row not provisioned yet) is not a dead end', async () => {
      const u = await makeUser(signer);
      const res = await req('PATCH', '/api/users/me', { token: u.token, body: { avatar_url: 'https://a.test/x.png' } });
      // Either provisions and applies, or 404 — but must not 500.
      expect([200, 404]).toContain(res.status);
    });

    it('PATCH cannot change identity fields (email / keycloak_id / id)', async () => {
      const u = await makeUser(signer);
      const me = await req('GET', '/api/users/me', { token: u.token });
      const res = await req('PATCH', '/api/users/me', {
        token: u.token,
        body: { email: 'evil@x.test', keycloak_id: 'someone-else', id: 1, name: 'ok' },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe(u.email);
      expect(res.body.data.keycloak_id).toBe(u.sub);
      expect(res.body.data.id).toBe(me.body.data.id);
    });

    it('preferences accepts nested JSON and round-trips; non-object preferences → 422', async () => {
      const u = await makeUser(signer);
      await req('GET', '/api/users/me', { token: u.token });
      const prefs = { theme: 'dark', langs: ['ja', 'en'], nested: { a: { b: 1 } } };
      const ok = await req('PATCH', '/api/users/me', { token: u.token, body: { preferences: prefs } });
      expect(ok.status).toBe(200);
      expect(ok.body.data.preferences).toEqual(prefs);
      for (const bad of [[1, 2], 'dark', 42, null]) {
        const res = await req('PATCH', '/api/users/me', { token: u.token, body: { preferences: bad } });
        expect.soft(res.status, JSON.stringify(bad)).toBe(422);
      }
    });

    it('users/me with a NUL byte in the PATCHed name or preferences → 422, never 500', async () => {
      const u = await makeUser(signer);
      await req('GET', '/api/users/me', { token: u.token });
      const name = await req('PATCH', '/api/users/me', { token: u.token, body: { name: 'a\u0000b' } });
      expect.soft(name.status).toBe(422);
      const prefs = await req('PATCH', '/api/users/me', { token: u.token, body: { preferences: { k: 'a\u0000b' } } });
      expect.soft(prefs.status).toBe(422);
      const nestedKey = await req('PATCH', '/api/users/me', {
        token: u.token,
        body: { preferences: { deep: [{ ['k\u0000']: 1 }] } },
      });
      expect.soft(nestedKey.status).toBe(422);
      // A literal backslash-u sequence is ordinary text and must still be accepted.
      const literal = await req('PATCH', '/api/users/me', { token: u.token, body: { preferences: { k: '\\u0000' } } });
      expect.soft(literal.status).toBe(200);
    });
  });

  it('DB is left without orphans after all flows', async () => {
    const orphans = await sql<{ n: number }>(
      dbUrl,
      `select (select count(*) from activities a left join days d on d.id=a.day_id where d.id is null)
            + (select count(*) from days d left join destinations x on x.id=d.destination_id where x.id is null)
            + (select count(*) from hotels h left join destinations x on x.id=h.destination_id where x.id is null) as n`,
    );
    expect(Number(orphans[0]!.n)).toBe(0);
    expect(await count('users')).toBeGreaterThan(0);
  });
});
