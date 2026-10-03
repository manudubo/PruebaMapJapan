import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  verifyJwt,
  getKeycloakJwks,
  __resetJwksCacheForTests,
  JWKS_FORCED_REFRESH_COOLDOWN_MS,
} from './keycloak';
import {
  TEST_ENV,
  generateTestKey,
  jwksBody,
  signJwt,
  validClaims,
  type TestKey,
} from './jwt-test-fixtures';

// SEC-05: forced JWKS refreshes (unknown kid / bad signature) are limited to
// one per cooldown window, so bogus tokens cannot turn every request into a
// Keycloak round-trip. Real RS256 keys; only Date is faked so Web Crypto's
// own promises keep resolving normally.

const T0 = new Date('2026-09-30T12:00:00Z').getTime();
const HOUR = 60 * 60 * 1000;

let key1: TestKey;
let key2: TestKey;
let forger: TestKey;

/** What Keycloak currently publishes; tests mutate it to simulate rotation/outage. */
let published: { status: number; body: unknown };
let fetchMock: ReturnType<typeof vi.fn>;

function fetchCount(): number {
  return fetchMock.mock.calls.length;
}

function setNow(ms: number) {
  vi.setSystemTime(ms);
}

beforeAll(async () => {
  key1 = await generateTestKey('k1');
  key2 = await generateTestKey('k2');
  forger = await generateTestKey('k1'); // same kid as key1, different key material
});

beforeEach(() => {
  __resetJwksCacheForTests();
  vi.useFakeTimers({ toFake: ['Date'] });
  setNow(T0);
  published = { status: 200, body: jwksBody(key1) };
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(published.body), { status: published.status }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function sign(key: TestKey, overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  // exp relative to the faked clock
  const now = Math.floor(Date.now() / 1000);
  return signJwt(key, validClaims({ iat: now, exp: now + 3600, ...overrides }), header);
}

describe('JWKS forced-refresh cooldown (SEC-05)', () => {
  it('a burst of unknown-kid tokens triggers at most one forced refresh', async () => {
    await verifyJwt(await sign(key1), TEST_ENV); // warm cache
    expect(fetchCount()).toBe(1);

    for (let i = 0; i < 50; i++) {
      const t = await sign(key1, {}, { kid: `random-${i}` });
      await expect(verifyJwt(t, TEST_ENV)).rejects.toThrow(/signing key not found/);
    }
    expect(fetchCount()).toBe(2); // warm-up + exactly one forced refresh
  });

  it('a burst of forged signatures (known kid) triggers at most one forced refresh', async () => {
    await verifyJwt(await sign(key1), TEST_ENV);
    for (let i = 0; i < 50; i++) {
      await expect(verifyJwt(await sign(forger), TEST_ENV)).rejects.toThrow(/signature verification failed/);
    }
    expect(fetchCount()).toBe(2);
  });

  it('100 concurrent bogus tokens against a cold cache → 2 fetches total', async () => {
    const tokens = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        i % 2 ? sign(forger) : sign(key1, {}, { kid: `nope-${i}` }),
      ),
    );
    const results = await Promise.allSettled(tokens.map((t) => verifyJwt(t, TEST_ENV)));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    // one cold fetch (deduplicated in flight) + one forced refresh
    expect(fetchCount()).toBe(2);
  });

  it('cooldown boundary: no refetch at cooldown-1ms, refetch at exactly cooldown', async () => {
    await verifyJwt(await sign(key1), TEST_ENV);
    await expect(verifyJwt(await sign(key1, {}, { kid: 'x' }), TEST_ENV)).rejects.toThrow();
    expect(fetchCount()).toBe(2);

    setNow(T0 + JWKS_FORCED_REFRESH_COOLDOWN_MS - 1);
    await expect(verifyJwt(await sign(key1, {}, { kid: 'y' }), TEST_ENV)).rejects.toThrow();
    expect(fetchCount()).toBe(2);

    setNow(T0 + JWKS_FORCED_REFRESH_COOLDOWN_MS);
    await expect(verifyJwt(await sign(key1, {}, { kid: 'z' }), TEST_ENV)).rejects.toThrow();
    expect(fetchCount()).toBe(3);
  });

  it('valid tokens keep verifying from cache while the cooldown is active', async () => {
    await verifyJwt(await sign(key1), TEST_ENV);
    await expect(verifyJwt(await sign(key1, {}, { kid: 'x' }), TEST_ENV)).rejects.toThrow();
    for (let i = 0; i < 10; i++) {
      await expect(verifyJwt(await sign(key1), TEST_ENV)).resolves.toMatchObject({ sub: 'user-123' });
    }
    expect(fetchCount()).toBe(2);
  });

  it('legitimate key rotation is picked up by a forced refresh', async () => {
    await verifyJwt(await sign(key1), TEST_ENV);
    published.body = jwksBody(key1, key2); // Keycloak rotates in k2
    await expect(verifyJwt(await sign(key2), TEST_ENV)).resolves.toMatchObject({ sub: 'user-123' });
    expect(fetchCount()).toBe(2);
  });

  it('rotation during an attacker-triggered cooldown is accepted once the window passes', async () => {
    await verifyJwt(await sign(key1), TEST_ENV);
    await expect(verifyJwt(await sign(key1, {}, { kid: 'attack' }), TEST_ENV)).rejects.toThrow();

    published.body = jwksBody(key1, key2);
    setNow(T0 + 10_000);
    await expect(verifyJwt(await sign(key2), TEST_ENV)).rejects.toThrow(/signing key not found/);

    setNow(T0 + JWKS_FORCED_REFRESH_COOLDOWN_MS + 1);
    await expect(verifyJwt(await sign(key2), TEST_ENV)).resolves.toMatchObject({ sub: 'user-123' });
  });

  it('TTL expiry still refreshes normally, independent of the cooldown', async () => {
    await verifyJwt(await sign(key1), TEST_ENV);
    await expect(verifyJwt(await sign(key1, {}, { kid: 'x' }), TEST_ENV)).rejects.toThrow();
    expect(fetchCount()).toBe(2);

    setNow(T0 + HOUR + 1);
    await verifyJwt(await sign(key1), TEST_ENV);
    expect(fetchCount()).toBe(3);
  });

  it('a failed forced refresh (Keycloak 503) keeps serving the previous keys', async () => {
    await verifyJwt(await sign(key1), TEST_ENV);
    published.status = 503;
    await expect(verifyJwt(await sign(key1, {}, { kid: 'x' }), TEST_ENV)).rejects.toThrow(/Failed to fetch JWKS/);
    expect(fetchCount()).toBe(2);

    // Valid k1 token still verifies from the restored cache — no extra fetch.
    await expect(verifyJwt(await sign(key1), TEST_ENV)).resolves.toMatchObject({ sub: 'user-123' });
    expect(fetchCount()).toBe(2);
  });

  it('a failed fetch does not poison the in-flight slot', async () => {
    published.status = 503;
    await expect(getKeycloakJwks(TEST_ENV)).rejects.toThrow();
    published.status = 200;
    await expect(getKeycloakJwks(TEST_ENV)).resolves.toBeInstanceOf(Map);
    expect(fetchCount()).toBe(2);
  });

  it('concurrent cold-cache callers share a single fetch', async () => {
    const maps = await Promise.all(Array.from({ length: 20 }, () => getKeycloakJwks(TEST_ENV)));
    expect(new Set(maps).size).toBe(1);
    expect(fetchCount()).toBe(1);
  });

  it('claims are validated before any JWKS fetch (wrong issuer never reaches Keycloak)', async () => {
    for (let i = 0; i < 20; i++) {
      await expect(verifyJwt(await sign(key1, { iss: 'https://evil' }, { kid: `k-${i}` }), TEST_ENV)).rejects.toThrow(/issuer/);
    }
    expect(fetchCount()).toBe(0);
  });

  it('non-base64url signature is rejected cleanly', async () => {
    const [h, p] = (await sign(key1)).split('.');
    await expect(verifyJwt(`${h}.${p}.***not-base64***`, TEST_ENV)).rejects.toThrow(/Malformed JWT signature/);
  });
});
