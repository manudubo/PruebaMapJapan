/**
 * Adversarial: two users poking at each other's resources (IDOR), plus
 * cross-parent id mixing inside one user's own data.
 *
 * Invariant under test: Bob can never read, modify, reorder or delete
 * anything under Alice's trip, whatever id combination he sends, and Alice's
 * data is byte-for-byte unchanged afterwards. Since SEC-22 every such
 * request is a 404 that is byte-identical to the one for an id that does not
 * exist (no existence oracle).
 */
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
  type Req,
  type TestUser,
  type Tree,
} from './harness';

let dbUrl: string;
let req: Req;
let alice: TestUser;
let bob: TestUser;
let aTree: Tree;
let bTree: Tree;
let aliceSnapshot: string;

async function aliceView(): Promise<string> {
  const res = await req('GET', `/api/trips/${aTree.tripId}`, { token: alice.token });
  expect(res.status).toBe(200);
  return JSON.stringify({ ...res.body.data, updated_at: undefined });
}

describeDb('IDOR — Bob vs Alice', () => {
  beforeAll(async () => {
    const signer = await createSigner();
    installFakeNetwork([signer]);
    dbUrl = await createTestDatabase('idor');
    req = client(makeEnv(dbUrl));
    alice = await makeUser(signer);
    bob = await makeUser(signer);
    aTree = await buildTree(req, alice.token, 3);
    await req('PUT', `/api/trips/${aTree.tripId}/destinations/${aTree.destId}/hotel`, {
      token: alice.token,
      body: { name: 'Alice Hotel' },
    });
    bTree = await buildTree(req, bob.token, 2);
    aliceSnapshot = await aliceView();
  }, 60_000);

  afterAll(async () => {
    await dropTestDatabase(dbUrl);
  });

  const a = () => aTree;
  const aDest = () => `/api/trips/${a().tripId}/destinations/${a().destId}`;
  const aAct = () => `${a().base}/activities/${a().actIds[0]}`;

  // Every route Bob might try against Alice's ids.
  const attacks: [string, string, () => string, unknown?][] = [
    ['GET trip', 'GET', () => `/api/trips/${a().tripId}`],
    ['PATCH trip', 'PATCH', () => `/api/trips/${a().tripId}`, { name: 'pwned' }],
    ['DELETE trip', 'DELETE', () => `/api/trips/${a().tripId}`],
    ['GET destinations', 'GET', () => `/api/trips/${a().tripId}/destinations`],
    ['POST destination', 'POST', () => `/api/trips/${a().tripId}/destinations`, { city_name: 'x', country: 'y' }],
    ['PATCH destination', 'PATCH', aDest, { city_name: 'pwned' }],
    ['DELETE destination', 'DELETE', aDest],
    ['GET hotel', 'GET', () => `${aDest()}/hotel`],
    ['PUT hotel', 'PUT', () => `${aDest()}/hotel`, { name: 'pwned' }],
    ['DELETE hotel', 'DELETE', () => `${aDest()}/hotel`],
    ['GET days', 'GET', () => `${aDest()}/days`],
    ['POST day', 'POST', () => `${aDest()}/days`, { date: '2026-03-03' }],
    ['PATCH day', 'PATCH', () => a().base, { label: 'pwned' }],
    ['DELETE day', 'DELETE', () => a().base],
    ['GET activities', 'GET', () => `${a().base}/activities`],
    ['POST activity', 'POST', () => `${a().base}/activities`, { name: 'pwned' }],
    ['PATCH activity', 'PATCH', aAct, { name: 'pwned' }],
    ['DELETE activity', 'DELETE', aAct],
    ['reorder activities', 'POST', () => `${a().base}/activities/reorder`, () => ({ ordered_ids: [...aTree.actIds].reverse() })],
  ];

  it.each(attacks)('Bob cannot %s on Alice\'s trip (404, never 2xx/403)', async (_l, method, path, body) => {
    const res = await req(method, path(), {
      token: bob.token,
      body: typeof body === 'function' ? (body as () => unknown)() : body,
    });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.text).not.toContain('Alice Hotel');
    expect(res.text).not.toContain('Act 0');
  });

  it('Alice\'s data is unchanged after every attack', async () => {
    expect(await aliceView()).toBe(aliceSnapshot);
  });

  it('Bob mixing HIS trip id with Alice\'s child ids is rejected (cross-parent confusion)', async () => {
    const b = bTree;
    const mixes: [string, string, unknown?][] = [
      ['PATCH', `/api/trips/${b.tripId}/destinations/${aTree.destId}`, { city_name: 'pwned' }],
      ['DELETE', `/api/trips/${b.tripId}/destinations/${aTree.destId}`],
      ['GET', `/api/trips/${b.tripId}/destinations/${aTree.destId}/hotel`],
      ['PUT', `/api/trips/${b.tripId}/destinations/${aTree.destId}/hotel`, { name: 'pwned' }],
      ['GET', `/api/trips/${b.tripId}/destinations/${aTree.destId}/days`],
      ['POST', `/api/trips/${b.tripId}/destinations/${aTree.destId}/days`, { date: '2026-01-01' }],
      ['PATCH', `/api/trips/${b.tripId}/destinations/${b.destId}/days/${aTree.dayId}`, { label: 'pwned' }],
      ['DELETE', `/api/trips/${b.tripId}/destinations/${b.destId}/days/${aTree.dayId}`],
      ['GET', `/api/trips/${b.tripId}/destinations/${b.destId}/days/${aTree.dayId}/activities`],
      ['POST', `/api/trips/${b.tripId}/destinations/${b.destId}/days/${aTree.dayId}/activities`, { name: 'pwned' }],
      ['PATCH', `${b.base}/activities/${aTree.actIds[0]}`, { name: 'pwned' }],
      ['DELETE', `${b.base}/activities/${aTree.actIds[1]}`],
      // Reorder Bob's own day but smuggle Alice's activity ids in.
      ['POST', `${b.base}/activities/reorder`, { ordered_ids: [...b.actIds, ...aTree.actIds] }],
      ['POST', `${b.base}/activities/reorder`, { ordered_ids: [aTree.actIds[0], b.actIds[1]] }],
    ];
    for (const [method, path, body] of mixes) {
      const res = await req(method, path, { token: bob.token, body });
      expect.soft(res.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
      expect.soft(res.status, `${method} ${path}`).toBeLessThan(500);
    }
    expect(await aliceView()).toBe(aliceSnapshot);
  });

  it('mass-assignment: Bob cannot create/patch a trip into Alice\'s account or pick its id/slug', async () => {
    const aliceMe = await req('GET', '/api/users/me', { token: alice.token });
    const created = await req('POST', '/api/trips', {
      token: bob.token,
      body: {
        name: 'mine',
        user_id: aliceMe.body.data.id,
        id: aTree.tripId,
        public_slug: '00000000-0000-4000-8000-000000000000',
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.id).not.toBe(aTree.tripId);
    expect(created.body.data.user_id).not.toBe(aliceMe.body.data.id);
    expect(created.body.data.public_slug).not.toBe('00000000-0000-4000-8000-000000000000');

    const patched = await req('PATCH', `/api/trips/${created.body.data.id}`, {
      token: bob.token,
      body: { user_id: aliceMe.body.data.id, name: 'still mine' },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.user_id).toBe(created.body.data.user_id);
    const aliceTrips = await req('GET', '/api/trips', { token: alice.token });
    expect(aliceTrips.body.data.map((t: { id: number }) => t.id)).toEqual([aTree.tripId]);
  });

  it('mass-assignment: Bob cannot move an activity into Alice\'s day via day_id in the body', async () => {
    const res = await req('PATCH', `${bTree.base}/activities/${bTree.actIds[0]}`, {
      token: bob.token,
      body: { day_id: aTree.dayId, name: 'moved?' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.day_id).toBe(bTree.dayId);
    expect(await aliceView()).toBe(aliceSnapshot);
  });

  it('GET /api/users/me/trips and /api/trips only list the caller\'s trips', async () => {
    for (const path of ['/api/trips', '/api/users/me/trips']) {
      const res = await req('GET', path, { token: bob.token });
      expect(res.status).toBe(200);
      expect(res.body.data.every((t: { id: number }) => t.id !== aTree.tripId)).toBe(true);
    }
  });

  // SEC-22: a 403 for "exists but not yours" vs 404 for "does not exist"
  // let any user enumerate which trip ids exist.
  it('SEC-22: foreign trip and non-existent trip are indistinguishable on nested routes', async () => {
    const foreign = await req('GET', `/api/trips/${aTree.tripId}/destinations`, { token: bob.token });
    const missing = await req('GET', '/api/trips/999999/destinations', { token: bob.token });
    expect(foreign.status).toBe(404);
    expect(foreign.status).toBe(missing.status);
    expect(foreign.text).toBe(missing.text);
  });

  it.each(attacks)('SEC-22: %s on Alice\'s ids answers exactly like the same route on ids that do not exist', async (_l, method, path, body) => {
    const realPath = path();
    // Same route shape, every numeric id replaced by one that does not exist.
    const ghostPath = realPath.replace(/\/(\d+)/g, (_m, id: string) => `/${900_000 + Number(id)}`);
    const payload = typeof body === 'function' ? (body as () => unknown)() : body;
    const foreign = await req(method, realPath, { token: bob.token, body: payload });
    const ghost = await req(method, ghostPath, { token: bob.token, body: payload });
    expect(foreign.status).toBe(404);
    expect(foreign.status).toBe(ghost.status);
    expect(foreign.text).toBe(ghost.text);
    expect(foreign.headers.get('content-length')).toBe(ghost.headers.get('content-length'));
  });

  it('SEC-22: Bob\'s own trip with Alice\'s child ids answers like missing child ids', async () => {
    const b = bTree;
    const pairs: [string, string, string][] = [
      ['GET', `/api/trips/${b.tripId}/destinations/${aTree.destId}/days`, `/api/trips/${b.tripId}/destinations/999999/days`],
      ['GET', `/api/trips/${b.tripId}/destinations/${b.destId}/days/${aTree.dayId}/activities`, `/api/trips/${b.tripId}/destinations/${b.destId}/days/999999/activities`],
      ['DELETE', `${b.base}/activities/${aTree.actIds[0]}`, `${b.base}/activities/999999`],
    ];
    for (const [method, real, ghost] of pairs) {
      const r = await req(method, real, { token: bob.token });
      const g = await req(method, ghost, { token: bob.token });
      expect(r.status, real).toBe(404);
      expect(r.text, real).toBe(g.text);
    }
  });

  it('SEC-22: unauthenticated requests still get 401 (not 404) on every nested route', async () => {
    for (const [, method, path, body] of attacks) {
      const res = await req(method, path(), { body: typeof body === 'function' ? (body as () => unknown)() : body });
      expect(res.status, `${method} ${path()}`).toBe(401);
    }
  });

  it('GET /api/trips/:id already returns 404 (not 403) for a foreign trip', async () => {
    const res = await req('GET', `/api/trips/${aTree.tripId}`, { token: bob.token });
    expect(res.status).toBe(404);
  });
});
