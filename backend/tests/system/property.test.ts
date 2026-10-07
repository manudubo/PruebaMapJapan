/**
 * System: seeded property / fuzz tests (hand-rolled PRNG, fixed seeds, so a
 * failure reproduces exactly; bump SEEDS locally to search harder).
 *
 *  1. BIZ-07 model check: random sequences of trip / destination / day
 *     writes through the real app; an independent TS model of the documented
 *     rules predicts accept/reject for every request, and the database must
 *     never hold a violating row.
 *  2. Validators vs Postgres (differential): whatever Zod accepts for a
 *     coordinate, date or clock time, Postgres must store (no 500 path), and
 *     the well-formed values Postgres accepts must not be refused by Zod.
 *  3. URL validator: accepted ⇔ WHATWG-parses with an http(s) scheme and
 *     contains no NUL, over hostile scheme spellings.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateActivitySchema, CreateTripSchema } from '../../src/validation/schemas';
import {
  BIZ07_VIOLATIONS_SQL,
  client,
  createSigner,
  createTestDatabase,
  dropTestDatabase,
  installFakeNetwork,
  makeEnv,
  makeUser,
  rng,
  sql,
  type Req,
  type Rng,
  type Signer,
} from './harness';

// PROP_SEEDS="1,2,3" searches other seeds locally; CI runs the fixed ones.
const SEEDS = process.env['PROP_SEEDS']?.split(',').map(Number) ?? [20261003, 7, 424242];

let signer: Signer;
let dbUrl: string;
let req: Req;
let pool: pg.Pool;

beforeAll(async () => {
  signer = await createSigner();
  installFakeNetwork([signer]);
  dbUrl = await createTestDatabase('prop');
  req = client(makeEnv(dbUrl, { ENVIRONMENT: 'development' }));
  pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
  pool.on('error', () => {});
}, 60_000);

afterAll(async () => {
  await pool.end();
  await dropTestDatabase(dbUrl);
});

// ---------------------------------------------------------------------------
// 1. BIZ-07 model
// ---------------------------------------------------------------------------

type D = string | null;
interface MDest { id: number; s: D; e: D; days: Map<number, string> }
interface MTrip { id: number; s: D; e: D; dests: Map<number, MDest> }

const lt = (a: D, b: D) => a !== null && b !== null && a < b;
const gt = (a: D, b: D) => a !== null && b !== null && a > b;

function withinTrip(t: MTrip, s: D, e: D): boolean {
  return !(lt(s, t.s) || gt(s, t.e) || lt(e, t.s) || gt(e, t.e));
}
function destOk(t: MTrip, id: number | null, s: D, e: D, days: Iterable<string>): boolean {
  if (gt(s, e)) return false;
  if (!withinTrip(t, s, e)) return false;
  if (s !== null && e !== null) {
    for (const o of t.dests.values()) {
      if (o.id !== id && o.s !== null && o.e !== null && o.s < e && s < o.e) return false;
    }
  }
  for (const day of days) if (lt(day, s) || gt(day, e)) return false;
  return true;
}
function tripOk(t: MTrip, s: D, e: D): boolean {
  if (gt(s, e)) return false;
  const probe = { ...t, s, e };
  for (const d of t.dests.values()) if (!withinTrip(probe, d.s, d.e)) return false;
  return true;
}

const day = (r: Rng) => `2026-03-${String(r.int(1, 15)).padStart(2, '0')}`;
const maybe = (r: Rng): D => (r.bool(0.2) ? null : day(r));

describe('BIZ-07 rules: model vs database under random writes', () => {
  it.each(SEEDS)('seed %i: 250 random ops, every status as the model predicts, no violating row', async (seed) => {
    const r = rng(seed);
    const u = await makeUser(signer);
    const trips: MTrip[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await req('POST', '/api/trips', { token: u.token, body: { name: `p${i}` } });
      trips.push({ id: res.body.data.id, s: null, e: null, dests: new Map() });
    }
    const log: string[] = [];
    const seen = { ok: 0, rejected: 0 };
    for (let step = 0; step < 250; step++) {
      const t = r.pick(trips);
      const dests = [...t.dests.values()];
      const op = r.int(0, 9);
      let path: string;
      let method: string;
      let body: Record<string, unknown> | undefined;
      let expectOk: boolean;
      let apply: (data: Record<string, unknown>) => void;

      if (op === 0) {
        const s = maybe(r);
        const e = maybe(r);
        [method, path, body] = ['PATCH', `/api/trips/${t.id}`, { start_date: s, end_date: e }];
        expectOk = tripOk(t, s, e);
        apply = () => { t.s = s; t.e = e; };
      } else if (op <= 3 || dests.length === 0) {
        const s = maybe(r);
        const e = r.bool(0.8) ? maybe(r) : s;
        [method, path, body] = ['POST', `/api/trips/${t.id}/destinations`, { city_name: 'c', country: 'j', start_date: s, end_date: e }];
        expectOk = destOk(t, null, s, e, []);
        apply = (data) => t.dests.set(data['id'] as number, { id: data['id'] as number, s, e, days: new Map() });
      } else if (op <= 5) {
        const d = r.pick(dests);
        const which = r.int(0, 2);
        const s = which === 1 ? d.s : maybe(r);
        const e = which === 0 ? d.e : maybe(r);
        body = which === 0 ? { start_date: s } : which === 1 ? { end_date: e } : { start_date: s, end_date: e };
        [method, path] = ['PATCH', `/api/trips/${t.id}/destinations/${d.id}`];
        expectOk = destOk(t, d.id, s, e, d.days.values());
        apply = () => { d.s = s; d.e = e; };
      } else if (op <= 7) {
        const d = r.pick(dests);
        const date = day(r);
        [method, path, body] = ['POST', `/api/trips/${t.id}/destinations/${d.id}/days`, { date }];
        expectOk = !(lt(date, d.s) || gt(date, d.e));
        apply = (data) => d.days.set(data['id'] as number, date);
      } else if (op === 8 && dests.some((d) => d.days.size > 0)) {
        const d = r.pick(dests.filter((x) => x.days.size > 0));
        const dayId = r.pick([...d.days.keys()]);
        const date = day(r);
        [method, path, body] = ['PATCH', `/api/trips/${t.id}/destinations/${d.id}/days/${dayId}`, { date }];
        expectOk = !(lt(date, d.s) || gt(date, d.e));
        apply = () => d.days.set(dayId, date);
      } else {
        const d = r.pick(dests);
        [method, path, body] = ['DELETE', `/api/trips/${t.id}/destinations/${d.id}`, undefined];
        expectOk = true;
        apply = () => t.dests.delete(d.id);
      }

      const res = await req(method, path, { token: u.token, body });
      log.push(`${step} ${method} ${path} ${JSON.stringify(body)} → ${res.status}`);
      if (expectOk) {
        expect(res.status, log.slice(-5).join('\n') + '\n' + res.text).toBeLessThan(300);
        apply(res.body?.data ?? {});
        seen.ok++;
      } else {
        seen.rejected++;
        expect(res.status, log.slice(-5).join('\n')).toBe(422);
        expect(['date_conflict', 'validation_error'], res.text).toContain(res.body.code);
      }
    }
    expect(await sql(dbUrl, BIZ07_VIOLATIONS_SQL)).toEqual([]);
    // The sequence must exercise both outcomes to mean anything.
    expect(seen.ok).toBeGreaterThan(50);
    expect(seen.rejected).toBeGreaterThan(30);
  });
});

// ---------------------------------------------------------------------------
// 2. Validators vs Postgres
// ---------------------------------------------------------------------------

/** For each value, did Postgres accept `value::type` (and what did it store)? */
async function pgCast(values: string[], castSql: string): Promise<({ ok: true; out: string } | { ok: false })[]> {
  const out: ({ ok: true; out: string } | { ok: false })[] = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); // savepoints isolate each failing cast
    for (const v of values) {
      await client.query('SAVEPOINT s');
      try {
        const { rows } = await client.query<{ out: string }>(`SELECT (${castSql})::text AS out`, [v]);
        out.push({ ok: true, out: rows[0]!.out });
        await client.query('RELEASE SAVEPOINT s');
      } catch {
        out.push({ ok: false });
        await client.query('ROLLBACK TO SAVEPOINT s');
      }
    }
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  return out;
}

function coordinateCandidates(r: Rng, n: number): unknown[] {
  const pieces = ['', '-', '+', ' ', '0', '9', '1', '.', '..', 'e', 'E', '5', '00', 'NaN', 'Infinity', '0x1', '1_0', '٣', '\t'];
  const out: unknown[] = [90, -90, 180, -180, 90.0000001, -0, 1e-7, 5e-324, '89.99999996', '90.00000004', '179.99999999', '.5', '5.', '+45', ' 45 ', '1e1', '-0'];
  while (out.length < n) {
    if (r.bool(0.3)) {
      out.push((r.next() - 0.5) * r.pick([2, 181, 361, 1e6]));
    } else {
      let s = '';
      for (let i = r.int(1, 6); i > 0; i--) s += r.pick(pieces);
      out.push(s);
    }
  }
  return out;
}

describe('coordinate validator vs Postgres numeric(10,7) + CHECK', () => {
  it.each(SEEDS)('seed %i: every value Zod accepts is stored by Postgres inside the range', async (seed) => {
    const r = rng(seed);
    for (const axis of ['lat', 'lng'] as const) {
      const limit = axis === 'lat' ? 90 : 180;
      const accepted: string[] = [];
      for (const v of coordinateCandidates(r, 400)) {
        const p = CreateActivitySchema.safeParse({ name: 'x', [axis]: v });
        if (p.success) accepted.push(p.data[axis] as string);
      }
      expect(accepted.length).toBeGreaterThan(20);
      const res = await pgCast(accepted, `$1::text::numeric(10,7)`);
      for (const [i, x] of res.entries()) {
        expect(x.ok, `Zod accepted ${JSON.stringify(accepted[i])} but Postgres rejects it`).toBe(true);
        if (x.ok) expect(Math.abs(Number(x.out)), accepted[i]).toBeLessThanOrEqual(limit);
      }
    }
  });
});

function dateCandidates(r: Rng, n: number): string[] {
  const out = ['0000-01-01', '0001-01-01', '9999-12-31', '2024-02-29', '2026-02-29', '1900-02-29', '2000-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-1-5', '20260101', '2026-01-01T00:00', ' 2026-01-01'];
  const pad = (x: number, w: number) => String(x).padStart(w, '0');
  while (out.length < n) {
    if (r.bool(0.85)) {
      const y = r.bool(0.2) ? r.pick([0, 1, 1582, 1900, 2000, 2100, 9999]) : r.int(1, 9999);
      out.push(`${pad(y, 4)}-${pad(r.int(0, 13), 2)}-${pad(r.int(0, 32), 2)}`);
    } else {
      out.push(`${r.int(0, 99999)}-${r.int(0, 99)}-${r.int(0, 99)}`);
    }
  }
  return out;
}

describe('date validator vs Postgres date', () => {
  it.each(SEEDS)('seed %i: Zod-accepted ⇒ Postgres stores it unchanged; well-formed Postgres dates ⇒ Zod accepts; string order = calendar order', async (seed) => {
    const r = rng(seed);
    const candidates = dateCandidates(r, 600);
    const res = await pgCast(candidates, `to_char($1::date, 'YYYY-MM-DD')`);
    const accepted: string[] = [];
    for (const [i, v] of candidates.entries()) {
      const zodOk = CreateTripSchema.safeParse({ name: 'x', start_date: v }).success;
      const pgRes = res[i]!;
      if (zodOk) {
        expect(pgRes.ok, `Zod accepted ${v}, Postgres rejects`).toBe(true);
        if (pgRes.ok) expect(pgRes.out).toBe(v);
        accepted.push(v);
      } else if (pgRes.ok && /^\d{4}-\d{2}-\d{2}$/.test(v) && pgRes.out === v) {
        throw new Error(`Postgres stores well-formed ${v} but Zod refuses it`);
      }
    }
    expect(accepted.length).toBeGreaterThan(100);
    // The BIZ-06/07 checks compare YYYY-MM-DD strings: must equal date order.
    const sorted = [...accepted].sort();
    const byTime = [...accepted].sort((a, b) => Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
    expect(sorted).toEqual(byTime);
  });
});

describe('clock-time validator vs Postgres time', () => {
  it.each(SEEDS)('seed %i: Zod-accepted ⇒ Postgres time round-trips; every valid HH:MM is accepted', async (seed) => {
    const r = rng(seed);
    const pad = (x: number) => String(x).padStart(2, '0');
    const candidates: string[] = ['24:00', '23:59:60', '7:30', '07:30 ', '0730', '07:30:00.5', '-1:00', '12:3a'];
    while (candidates.length < 400) {
      const base = `${pad(r.int(0, 29))}:${pad(r.int(0, 69))}`;
      candidates.push(r.bool(0.3) ? `${base}:${pad(r.int(0, 69))}` : base);
    }
    const accepted = candidates.filter((t) => CreateActivitySchema.safeParse({ name: 'x', time: t }).success);
    const res = await pgCast(accepted, `$1::time`);
    for (const [i, x] of res.entries()) {
      expect(x.ok, accepted[i]).toBe(true);
      if (x.ok) expect(x.out.startsWith(accepted[i]!.slice(0, 5))).toBe(true);
    }
    for (let h = 0; h < 24; h++) {
      for (const m of [0, r.int(1, 58), 59]) {
        expect(CreateActivitySchema.safeParse({ name: 'x', time: `${pad(h)}:${pad(m)}` }).success).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. URL validator
// ---------------------------------------------------------------------------

describe('http(s) URL validator', () => {
  const schemes = ['http:', 'https:', 'HTTPS:', 'hTtP:', 'javascript:', 'JaVaScRiPt:', ' javascript:', 'java\tscript:', 'java\nscript:', '\u0000javascript:', 'data:', 'vbscript:', 'file:', 'ftp:', 'blob:', ''];
  const middles = ['//', '/', '', '///', '\\\\', '//user:pw@'];
  const hosts = ['example.com', 'xn--n3h.com', 'ドメイン.テスト', 'localhost', '127.0.0.1', '[::1]', '', 'a b', 'ex%41mple.com'];
  const tails = ['', '/', '/path?q=1#h', '/<script>', '/%00', '/\u0000', "/'onerror=alert(1)", ':99999', ':80/x', '/日本'];

  function expected(v: string): boolean {
    if (v.includes('\u0000')) return false;
    try {
      return /^https?:$/i.test(new URL(v).protocol);
    } catch {
      return false;
    }
  }

  it.each(SEEDS)('seed %i: accepted ⇔ parses as WHATWG URL with an http(s) scheme and no NUL', (seed) => {
    const r = rng(seed);
    let accepted = 0;
    for (let i = 0; i < 1500; i++) {
      const v = r.pick(schemes) + r.pick(middles) + r.pick(hosts) + r.pick(tails);
      const ok = CreateActivitySchema.safeParse({ name: 'x', maps_url: v }).success;
      expect(ok, JSON.stringify(v)).toBe(expected(v));
      if (ok) {
        accepted++;
        // What a browser would navigate to must be http(s) too.
        expect(new URL(v).protocol).toMatch(/^https?:$/);
      }
    }
    expect(accepted).toBeGreaterThan(100);
  });
});
