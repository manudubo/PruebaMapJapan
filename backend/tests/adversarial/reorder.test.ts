/**
 * Adversarial: POST .../activities/reorder with hostile id lists, huge days
 * and concurrent reorders. Invariant: a rejected reorder writes nothing; an
 * accepted one leaves order_index = 0..n-1 in exactly the requested order.
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
  sql,
  type Req,
  type TestUser,
  type Tree,
} from './harness';

let dbUrl: string;
let req: Req;
let user: TestUser;
let tree: Tree;
let otherDay: Tree;

async function order(dayId: number): Promise<{ id: number; order_index: number }[]> {
  return sql(dbUrl, 'select id, order_index from activities where day_id = $1 order by order_index, id', [dayId]);
}

describeDb('activity reorder', () => {
  beforeAll(async () => {
    const signer = await createSigner();
    installFakeNetwork([signer]);
    dbUrl = await createTestDatabase('reorder');
    req = client(makeEnv(dbUrl));
    user = await makeUser(signer);
    tree = await buildTree(req, user.token, 4);
    otherDay = await buildTree(req, user.token, 2);
  }, 60_000);

  afterAll(async () => {
    await dropTestDatabase(dbUrl);
  });

  const reorder = (ordered_ids: unknown, t: Tree = tree) =>
    req('POST', `${t.base}/activities/reorder`, { token: user.token, body: { ordered_ids } });

  it('valid permutation → 200, response and DB in requested order with 0..n-1', async () => {
    const want = [tree.actIds[2]!, tree.actIds[0]!, tree.actIds[3]!, tree.actIds[1]!];
    const res = await reorder(want);
    expect(res.status).toBe(200);
    expect(res.body.data.map((a: { id: number }) => a.id)).toEqual(want);
    expect(res.body.data.map((a: { order_index: number }) => a.order_index)).toEqual([0, 1, 2, 3]);
    expect((await order(tree.dayId)).map((r) => r.id)).toEqual(want);
  });

  it.each([
    ['empty list on a non-empty day', () => []],
    ['one id missing', () => tree.actIds.slice(1)],
    ['duplicate id (same length)', () => [tree.actIds[0], tree.actIds[0], tree.actIds[1], tree.actIds[2]]],
    ['extra id appended', () => [...tree.actIds, 999_999]],
    ['foreign id from another day of the same user', () => [...tree.actIds.slice(1), otherDay.actIds[0]]],
    ['10k ids', () => Array.from({ length: 10_000 }, (_, i) => i + 1)],
    ['id beyond int4 (passes the schema, fails the permutation check)', () => [...tree.actIds.slice(1), 2 ** 31]],
  ])('%s → 400 and nothing written', async (_l, ids) => {
    const before = await order(tree.dayId);
    const res = await reorder(ids());
    expect(res.status).toBe(400);
    expect(await order(tree.dayId)).toEqual(before);
  });

  it.each([
    ['zero', [0]],
    ['negative', [-1]],
    ['float', [1.5]],
    ['string ids', ['1', '2']],
    ['null entries', [null]],
    ['nested arrays', [[1]]],
    ['not an array', 'all'],
    ['null', null],
  ])('ordered_ids = %s → 422 (validation), never 500', async (_l, ids) => {
    const res = await reorder(ids);
    expect(res.status).toBe(422);
  });

  it('missing ordered_ids key → 422', async () => {
    const res = await req('POST', `${tree.base}/activities/reorder`, { token: user.token, body: {} });
    expect(res.status).toBe(422);
  });

  it('empty list on an empty day → 200 []', async () => {
    const day = await req('POST', `/api/trips/${tree.tripId}/destinations/${tree.destId}/days`, {
      token: user.token,
      body: { date: '2026-03-04' },
    });
    const res = await req(
      'POST',
      `/api/trips/${tree.tripId}/destinations/${tree.destId}/days/${day.body.data.id}/activities/reorder`,
      { token: user.token, body: { ordered_ids: [] } },
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('"reorder" is not captured as an :actId by PATCH/DELETE (routes do not collide)', async () => {
    const del = await req('DELETE', `${tree.base}/activities/reorder`, { token: user.token });
    expect([400, 404]).toContain(del.status);
    expect((await order(tree.dayId)).length).toBe(4);
  });

  it('reorder of a real 2 000-activity day works and is exact', async () => {
    const big = await buildTree(req, user.token, 0);
    await sql(
      dbUrl,
      `insert into activities (day_id, name, order_index) select $1, 'bulk ' || g, g from generate_series(1, 2000) g`,
      [big.dayId],
    );
    const ids = (await order(big.dayId)).map((r) => r.id).reverse();
    const res = await reorder(ids, big);
    expect(res.status).toBe(200);
    const after = await order(big.dayId);
    expect(after.map((r) => r.id)).toEqual(ids);
    expect(after.map((r) => r.order_index)).toEqual(ids.map((_, i) => i));
  }, 60_000);

  it('20 concurrent reorders with different permutations leave ONE consistent permutation', async () => {
    const perms = Array.from({ length: 20 }, (_, k) => {
      const ids = [...tree.actIds];
      for (let i = ids.length - 1; i > 0; i--) {
        const j = (k * 7 + i * 3) % (i + 1);
        [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      }
      return ids;
    });
    const results = await Promise.all(perms.map((p) => reorder(p)));
    for (const r of results) expect(r.status).toBe(200);
    const final = await order(tree.dayId);
    expect(final.map((r) => r.order_index)).toEqual([0, 1, 2, 3]);
    expect(perms.map((p) => p.join(','))).toContain(final.map((r) => r.id).join(','));
  });

  it('reorder racing a delete of one of its activities never 500s and never resurrects it', async () => {
    const t = await buildTree(req, user.token, 5);
    const victim = t.actIds[2]!;
    const [ro, del] = await Promise.all([
      reorder([...t.actIds].reverse(), t),
      req('DELETE', `${t.base}/activities/${victim}`, { token: user.token }),
    ]);
    expect(del.status).toBe(200);
    expect([200, 400]).toContain(ro.status);
    const rows = await order(t.dayId);
    expect(rows.map((r) => r.id)).not.toContain(victim);
    expect(rows).toHaveLength(4);
  });
});
