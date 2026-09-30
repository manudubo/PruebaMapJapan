/**
 * Adversarial: Authorization header + JWT verification (src/middleware/auth.ts,
 * src/auth/keycloak.ts). Tokens are signed with a real RSA key served by a
 * fake JWKS endpoint, so the real verifier runs end to end.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AUDIENCE,
  ISSUER,
  b64url,
  client,
  createSigner,
  createTestDatabase,
  describeDb,
  dropTestDatabase,
  installFakeNetwork,
  makeEnv,
  makeUser,
  type FakeNetwork,
  type Req,
  type Signer,
} from './harness';

let signer: Signer;
let rogue: Signer; // same kid, different key — not published in JWKS
let net: FakeNetwork;
let dbUrl = 'postgresql://unused@127.0.0.1:1/none';
let req: Req;

const now = () => Math.floor(Date.now() / 1000);
// Email is unique per subject: users.email is UNIQUE since DATA-02 (Phase 24).
const claims = (over: Record<string, unknown> = {}) => ({
  sub: 'kc-jwt-user',
  iss: ISSUER,
  aud: AUDIENCE,
  email: `${String(over.sub ?? 'kc-jwt-user')}@example.test`,
  name: 'Jwt User',
  preferred_username: 'jwt',
  email_verified: true,
  iat: now(),
  exp: now() + 600,
  ...over,
});

beforeAll(async () => {
  signer = await createSigner('kid-main');
  rogue = await createSigner('kid-main');
  net = installFakeNetwork([signer]);
  dbUrl = await createTestDatabase('jwt');
  req = client(makeEnv(dbUrl));
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(dbUrl);
});

async function get(authorization?: string | string[]) {
  // Duplicate headers reach the app joined with ", " (Fetch Headers semantics).
  const value = Array.isArray(authorization) ? authorization.join(', ') : authorization;
  return req('GET', '/api/trips', { headers: value === undefined ? {} : { Authorization: value } });
}

describe('Authorization header shape (no DB needed — rejected before provisioning)', () => {
  it.each([
    ['missing header', undefined],
    ['empty header', ''],
    ['scheme only', 'Bearer'],
    ['scheme + space, no token', 'Bearer '],
    ['Basic scheme', 'Basic dXNlcjpwYXNz'],
    ['token without scheme', 'eyJhbGciOiJSUzI1NiJ9.e30.sig'],
    ['one-part token', 'Bearer abc'],
    ['four-part token', 'Bearer a.b.c.d'],
    ['garbage base64 header', 'Bearer !!!.@@@.###'],
    ['non-JSON header segment', `Bearer ${b64url('not json')}.${b64url('{}')}.x`],
  ])('401 for %s', async (_label, value) => {
    const res = await get(value as string | undefined);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('401 for lowercase "bearer" scheme (strict match, fails closed)', async () => {
    const token = await signer.sign(claims());
    expect((await get(`bearer ${token}`)).status).toBe(401);
  });

  it('401 when two Authorization headers are sent (valid + garbage) — fails closed', async () => {
    const token = await signer.sign(claims());
    // Headers.append joins duplicates with ", " — the joined value must not verify.
    expect((await get([`Bearer ${token}`, 'Bearer x.y.z'])).status).toBe(401);
    expect((await get(['Bearer x.y.z', `Bearer ${token}`])).status).toBe(401);
  });
});

describe('JWT claim/algorithm attacks (no DB needed)', () => {
  it('alg=none with empty signature → 401', async () => {
    const h = b64url(JSON.stringify({ alg: 'none', typ: 'JWT', kid: 'kid-main' }));
    const p = b64url(JSON.stringify(claims()));
    expect((await get(`Bearer ${h}.${p}.`)).status).toBe(401);
  });

  it('alg=NONE / None casing variants → 401', async () => {
    for (const alg of ['NONE', 'None', 'nOnE']) {
      const h = b64url(JSON.stringify({ alg, kid: 'kid-main' }));
      expect((await get(`Bearer ${h}.${b64url(JSON.stringify(claims()))}.`)).status).toBe(401);
    }
  });

  it('alg=HS256 (key-confusion attempt) → 401', async () => {
    const token = await signer.sign(claims(), { alg: 'HS256' });
    expect((await get(`Bearer ${token}`)).status).toBe(401);
  });

  it('missing kid → 401', async () => {
    const token = await signer.sign(claims(), { kid: undefined });
    expect((await get(`Bearer ${token}`)).status).toBe(401);
  });

  it('signed by a different key with the published kid → 401', async () => {
    const token = await rogue.sign(claims());
    expect((await get(`Bearer ${token}`)).status).toBe(401);
  });

  it('payload tampered after signing (sub swapped) → 401', async () => {
    const token = await signer.sign(claims());
    const [h, , s] = token.split('.');
    const forged = b64url(JSON.stringify(claims({ sub: 'someone-else' })));
    expect((await get(`Bearer ${h}.${forged}.${s}`)).status).toBe(401);
  });

  it.each([
    ['expired', { exp: now() - 1 }],
    ['exp missing', { exp: undefined }],
    ['exp = 0', { exp: 0 }],
    ['nbf in the future', { nbf: now() + 3600 }],
    ['nbf as a string', { nbf: 'later' }],
    ['wrong issuer', { iss: 'http://evil.test/realms/japan-trip' }],
    ['issuer with trailing slash', { iss: `${ISSUER}/` }],
    ['issuer different realm', { iss: 'http://kc.test/realms/master' }],
    ['issuer missing', { iss: undefined }],
    ['audience missing', { aud: undefined }],
    ['audience wrong', { aud: 'account' }],
    ['audience empty array', { aud: [] }],
    ['sub missing', { sub: undefined }],
    ['sub empty', { sub: '' }],
  ])('401 for %s', async (_label, over) => {
    const token = await signer.sign(claims(over));
    const res = await get(`Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('exp that is not a number is rejected (a string exp must not mean "never expires")', async () => {
    for (const exp of ['tomorrow', '9999999999x', null, true]) {
      const token = await signer.sign(claims({ exp }));
      expect.soft((await get(`Bearer ${token}`)).status, JSON.stringify(exp)).toBe(401);
    }
  });

  it('JWKS endpoint down → 401, never 500 / never accepted', async () => {
    // A kid that is not cached forces a JWKS fetch; make that fetch fail.
    const token = await signer.sign(claims(), { kid: 'unknown-kid-for-outage' });
    net.failJwks = true;
    try {
      const res = await get(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    } finally {
      net.failJwks = false;
    }
  });

  // SEC-06 (fixed in Phase 26): verification errors must not echo issuer/realm/audience config.
  it('SEC-06: 401 body is a generic invalid_token (no issuer/realm detail)', async () => {
    const token = await signer.sign(claims({ iss: 'http://evil.test/realms/x' }));
    const res = await get(`Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.text).not.toContain(ISSUER);
    expect(res.text).not.toContain('realms');
  });

  // SEC-05 (fixed in Phase 26 by the JWKS refresh cooldown): every unknown kid
  // used to force a JWKS refetch — an unauthenticated Keycloak amplifier.
  it('SEC-05: 20 forged tokens with random kids cause at most 1 extra JWKS fetch', async () => {
    const before = net.jwksFetches;
    for (let i = 0; i < 20; i++) {
      const token = await signer.sign(claims(), { kid: `random-${i}` });
      await get(`Bearer ${token}`);
    }
    expect(net.jwksFetches - before).toBeLessThanOrEqual(1);
  });
});

describeDb('JWT success paths (real DB)', () => {
  it('valid token → 200 and user is provisioned', async () => {
    const token = await signer.sign(claims({ sub: 'kc-ok-1' }));
    const res = await get(`Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('aud as array containing the frontend client is accepted', async () => {
    const token = await signer.sign(claims({ sub: 'kc-ok-2', aud: ['account', AUDIENCE] }));
    expect((await get(`Bearer ${token}`)).status).toBe(200);
  });

  it('token without email/name claims still works (passkey-only user)', async () => {
    const token = await signer.sign(
      claims({ sub: 'kc-ok-3', email: undefined, name: undefined, preferred_username: undefined }),
    );
    const res = await req('GET', '/api/users/me', { token });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data.keycloak_id).toBe('kc-ok-3');
    expect(res.body.data.email).toBe('');
    expect(res.body.data.name).toBe('kc-ok-3');
  });

  it('non-ASCII name/email claims are stored exactly (UTF-8, not mojibake)', async () => {
    const name = 'José Pérez 田中 太郎 👩‍💻';
    const email = 'josé@exämple.test';
    const user = await makeUser(signer, { name, email });
    const me = await req('GET', '/api/users/me', { token: user.token });
    expect(me.status).toBe(201);
    expect(me.body.data.name).toBe(name);
    expect(me.body.data.email).toBe(email);
  });

  it('two different subjects without email can both provision (guards DATA-02 unique-email work)', async () => {
    for (const sub of ['kc-noemail-a', 'kc-noemail-b']) {
      const token = await signer.sign(claims({ sub, email: undefined }));
      expect((await get(`Bearer ${token}`)).status).toBe(200);
    }
  });

  it('display name longer than the 255-char column does not lock the user out', async () => {
    // Keycloak builds `name` from first + last name (each up to 255 chars).
    const user = await makeUser(signer, { name: `${'Ｎ'.repeat(200)} ${'名'.repeat(200)}` });
    const res = await req('GET', '/api/trips', { token: user.token });
    expect(res.status).toBe(200);
    const me = await req('GET', '/api/users/me', { token: user.token });
    expect(me.status).toBe(200);
    expect(Array.from(me.body.data.name as string)).toHaveLength(255);
  });

  it('display name containing a NUL byte does not lock the user out', async () => {
    const user = await makeUser(signer, { name: 'Evil\u0000Name' });
    const res = await req('GET', '/api/trips', { token: user.token });
    expect(res.status).toBe(200);
    const me = await req('GET', '/api/users/me', { token: user.token });
    expect(me.body.data.name).toBe('EvilName');
  });
});
