/**
 * System: the app on the PRODUCTION driver (DB_DRIVER="neon",
 * @neondatabase/serverless over HTTP), against real Postgres through
 * installNeonHttpFake (one statement per HTTP call, autocommit).
 *
 * Production has no interactive / multi-statement transactions. These tests
 * prove that every route still behaves correctly when each statement is its
 * own transaction, and that the atomicity the app relies on (BIZ-07 trigger
 * locks, otp_issue's advisory lock, ON CONFLICT upserts, single-statement
 * reorder/consume) lives inside single statements.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
} from './harness';

let dbUrl: string;
let req: Req;
let signer: Signer;
let net: FakeNetwork;
let neon: NeonFake;

beforeAll(async () => {
  signer = await createSigner();
  net = installFakeNetwork([signer]);
  neon = installNeonHttpFake();
  dbUrl = await createTestDatabase('neon');
  req = client(makeEnv(dbUrl, { DB_DRIVER: 'neon', ENVIRONMENT: 'development' }));
}, 60_000);

afterAll(async () => {
  await neon.close();
  await dropTestDatabase(dbUrl);
});

/** Statements that would need a session/interactive transaction. */
const SESSION_ONLY = /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|SET\s|LOCK\s)|pg_advisory_lock\(|pg_try_advisory_lock\(/i;

describe('neon-http driver: full owner flow', () => {
  it('create → hotel → days → activities → reorder → share → public read → delete, one statement per call', async () => {
    const u = await makeUser(signer);
    const start = neon.statements.length;
    const tree = await buildTree(req, u.token, 3);
    const hotel = await req('PUT', `/api/trips/${tree.tripId}/destinations/${tree.destId}/hotel`, {
      token: u.token,
      body: { name: 'Ryokan', lat: 35.0, lng: 135.7, check_in_date: '2026-03-01', check_out_date: '2026-03-05' },
    });
    expect(hotel.status, hotel.text).toBe(200);
    const hotel2 = await req('PUT', `/api/trips/${tree.tripId}/destinations/${tree.destId}/hotel`, {
      token: u.token,
      body: { name: 'Ryokan 2' },
    });
    expect(hotel2.body.data.id).toBe(hotel.body.data.id);

    const order = [...tree.actIds].reverse();
    const re = await req('POST', `${tree.base}/activities/reorder`, { token: u.token, body: { ordered_ids: order } });
    expect(re.status, re.text).toBe(200);
    expect(re.body.data.map((a: { id: number }) => a.id)).toEqual(order);

    const share = await req('PATCH', `/api/trips/${tree.tripId}`, { token: u.token, body: { is_public: true } });
    expect(share.status).toBe(200);
    const slug = share.body.data.public_slug as string;
    const pub = await req('GET', `/api/public/trips/${slug}`);
    expect(pub.status, pub.text).toBe(200);
    expect(pub.text).not.toContain(u.sub);

    const me = await req('GET', '/api/users/me', { token: u.token });
    expect(me.status).toBe(200);
    const del = await req('DELETE', `/api/trips/${tree.tripId}`, { token: u.token });
    expect(del.status).toBe(200);
    expect((await req('GET', `/api/public/trips/${slug}`)).status).toBe(404);

    const used = neon.statements.slice(start);
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((s) => SESSION_ONLY.test(s))).toEqual([]);
    expect(neon.batches).toBe(0);
  });

  it('BIZ-07 trigger errors keep SQLSTATE and COLUMN through NeonDbError → 422 date_conflict with the field', async () => {
    const u = await makeUser(signer);
    const t = await req('POST', '/api/trips', {
      token: u.token,
      body: { name: 'n', start_date: '2026-03-01', end_date: '2026-03-10' },
    });
    const tripId = t.body.data.id;
    const d = await req('POST', `/api/trips/${tripId}/destinations`, {
      token: u.token,
      body: { city_name: 'Osaka "Ō"', country: 'JP', start_date: '2026-03-02', end_date: '2026-03-12' },
    });
    expect(d.status).toBe(422);
    expect(d.body).toMatchObject({ code: 'date_conflict', issues: [{ path: 'end_date' }] });
    expect(d.text).not.toMatch(/insert into|DC001|biz07/i);

    const ok = await req('POST', `/api/trips/${tripId}/destinations`, {
      token: u.token,
      body: { city_name: 'Osaka', country: 'JP', start_date: '2026-03-02', end_date: '2026-03-05' },
    });
    const shrink = await req('PATCH', `/api/trips/${tripId}`, { token: u.token, body: { end_date: '2026-03-04' } });
    expect(shrink.status).toBe(422);
    expect(shrink.body.issues[0].path).toBe('end_date');
    expect(shrink.body.error).toContain('Osaka');
    const day = await req('POST', `/api/trips/${tripId}/destinations/${ok.body.data.id}/days`, {
      token: u.token,
      body: { date: '2026-03-06' },
    });
    expect(day.status).toBe(422);
    expect(day.body.issues[0].path).toBe('date');
  });

  it('20 parallel identical destination creates on neon-http → exactly one (advisory lock inside the trigger statement)', async () => {
    const u = await makeUser(signer);
    const t = await req('POST', '/api/trips', { token: u.token, body: { name: 'race' } });
    const tripId = t.body.data.id;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        req('POST', `/api/trips/${tripId}/destinations`, {
          token: u.token,
          body: { city_name: 'K', country: 'JP', start_date: '2026-04-01', end_date: '2026-04-05' },
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 201 && r.status !== 422)).toEqual([]);
    expect(await sql(dbUrl, BIZ07_VIOLATIONS_SQL)).toEqual([]);
  });
});

describe('neon-http driver: OTP and provisioning races', () => {
  it('20 parallel otp-request on neon-http → one code, one email, 19 otp_pending (otp_issue is one statement)', async () => {
    const u = await makeUser(signer);
    await req('GET', '/api/users/me', { token: u.token });
    const before = net.mails.length;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => req('POST', '/api/auth/otp-request', { token: u.token })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 429 && r.body.error === 'otp_pending')).toHaveLength(19);
    expect(net.mails.length - before).toBe(1);
    const rows = await sql(dbUrl, `SELECT count(*)::int AS n FROM email_otp_codes c JOIN users u ON u.id = c.user_id WHERE u.keycloak_id = $1`, [u.sub]);
    expect(rows[0]!.n).toBe(1);

    const code = net.lastCodeFor(u.email)!;
    const verifies = await Promise.all(
      Array.from({ length: 5 }, () => req('POST', '/api/auth/otp-verify', { token: u.token, body: { code } })),
    );
    expect(verifies.filter((r) => r.status === 200)).toHaveLength(1);
    expect(verifies.filter((r) => r.status >= 500)).toEqual([]);
  });

  it('25 concurrent first requests of a new subject on neon-http → one user row, no 409/500', async () => {
    const u = await makeUser(signer);
    const paths = ['/api/trips', '/api/users/me', '/api/users/me/trips', '/api/auth/otp-request'];
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        req(i % 4 === 3 ? 'POST' : 'GET', paths[i % 4]!, { token: u.token }),
      ),
    );
    for (const r of results) expect([200, 201, 429], r.text).toContain(r.status);
    expect(await sql(dbUrl, 'SELECT id FROM users WHERE keycloak_id = $1', [u.sub])).toHaveLength(1);
  });

  it('two subjects racing for one email on neon-http → one owner, the other a clean 409 email_conflict', async () => {
    const email = `shared-${Date.now()}@example.test`;
    const a = await makeUser(signer, { email });
    const b = await makeUser(signer, { email: email.toUpperCase() });
    const results = await Promise.all([
      ...Array.from({ length: 6 }, () => req('GET', '/api/users/me', { token: a.token })),
      ...Array.from({ length: 6 }, () => req('GET', '/api/users/me', { token: b.token })),
    ]);
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
    const conflicts = results.filter((r) => r.status === 409);
    for (const c of conflicts) expect(c.body.code).toBe('email_conflict');
    const rows = await sql(dbUrl, `SELECT keycloak_id FROM users WHERE lower(email) = lower($1)`, [email]);
    expect(rows).toHaveLength(1);
    // The loser got only 409s; the winner only 2xx.
    const winner = rows[0]!.keycloak_id === a.sub ? 'a' : 'b';
    const winnerResults = winner === 'a' ? results.slice(0, 6) : results.slice(6);
    const loserResults = winner === 'a' ? results.slice(6) : results.slice(0, 6);
    for (const r of winnerResults) expect(r.status).toBeLessThan(300);
    for (const r of loserResults) expect(r.status).toBe(409);
  });
});

describe('neon-http static audit of src/', () => {
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'test-utils' ? [] : files(p);
      return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
    });

  it('no request-path code uses interactive transactions, batches, session locks or session SET', () => {
    const offenders: string[] = [];
    for (const f of files(SRC)) {
      if (f.endsWith(path.join('db', 'seed.ts'))) continue; // CLI script on node-postgres
      const text = fs.readFileSync(f, 'utf8');
      for (const [i, line] of text.split('\n').entries()) {
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        if (/\.transaction\(|\.batch\(|pg_advisory_lock\(|pg_try_advisory_lock\(|\bFOR UPDATE\b|\bSET (LOCAL|SESSION)\b|\bBEGIN\b/.test(line)) {
          offenders.push(`${path.relative(SRC, f)}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every lock in the migrations is transaction-scoped (released at statement end on neon-http)', () => {
    const dir = path.join(SRC, 'db/migrations');
    const sqlText = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    expect(sqlText).not.toMatch(/pg_advisory_lock\s*\(|pg_try_advisory_lock\s*\(/);
    const namespaces = new Set(
      [...sqlText.matchAll(/PERFORM pg_advisory_xact_lock\(\s*(\d+)/g)].map((m) => m[1]),
    );
    expect([...namespaces].sort()).toEqual(['7001', '7002']);
  });
});
