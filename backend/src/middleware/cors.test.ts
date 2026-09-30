import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { corsMiddleware, allowedOrigins, PRODUCTION_ORIGINS } from './cors';
import { resolveEnvironment, isDevelopment } from '../config/environment';
import realApp from '../index';
import type { Env } from '../types';

const app = new Hono<{ Bindings: { ENVIRONMENT?: string } }>();
app.use('*', corsMiddleware);
app.get('/test', (c) => c.json({ ok: true }));
app.post('/test', (c) => c.json({ ok: true }));

const PROD = { ENVIRONMENT: 'production' };
const DEV = { ENVIRONMENT: 'development' };
const PAGES = 'https://manud.github.io';

async function acaoFor(origin: string | null, env: { ENVIRONMENT?: string } | undefined) {
  const headers: Record<string, string> = {};
  if (origin !== null) headers['Origin'] = origin;
  const res = await app.request('/test', { method: 'GET', headers }, env);
  return res.headers.get('Access-Control-Allow-Origin');
}

async function preflight(origin: string, env: { ENVIRONMENT?: string }) {
  return app.request(
    '/test',
    {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    },
    env,
  );
}

describe('resolveEnvironment — fail-closed', () => {
  it.each([
    ['development', 'development'],
    ['Development', 'development'],
    ['  development \n', 'development'],
    ['production', 'production'],
    ['prod', 'production'],
    ['dev', 'production'], // abbreviations are not trusted
    ['develop', 'production'],
    ['staging', 'production'],
    ['', 'production'],
    ['development,production', 'production'],
  ])('%j → %s', (value, expected) => {
    expect(resolveEnvironment(value)).toBe(expected);
  });

  it('treats undefined/null as production', () => {
    expect(resolveEnvironment(undefined)).toBe('production');
    expect(resolveEnvironment(null)).toBe('production');
    expect(isDevelopment(undefined)).toBe(false);
    expect(isDevelopment({})).toBe(false);
    expect(isDevelopment(DEV)).toBe(true);
  });
});

describe('allowedOrigins (SEC-23)', () => {
  it('production list has no localhost/loopback entry at all', () => {
    for (const o of allowedOrigins('production')) {
      expect(o).not.toMatch(/localhost|127\.0\.0\.1|\[::1\]/);
      expect(o.startsWith('https://')).toBe(true);
    }
  });

  it('development list is a superset of production plus the Vite ports', () => {
    const dev = allowedOrigins('development');
    for (const o of PRODUCTION_ORIGINS) expect(dev).toContain(o);
    expect(dev).toContain('http://localhost:3000');
    expect(dev).toContain('http://localhost:5173');
  });
});

describe('CORS middleware — production (SEC-23)', () => {
  it('reflects the GitHub Pages origin', async () => {
    expect(await acaoFor(PAGES, PROD)).toBe(PAGES);
  });

  it.each(['http://localhost:5173', 'http://localhost:3000'])(
    'does NOT allow dev origin %s in production',
    async (origin) => {
      expect(await acaoFor(origin, PROD)).toBeNull();
    },
  );

  it('rejects dev origins when ENVIRONMENT is missing (fail-closed)', async () => {
    expect(await acaoFor('http://localhost:5173', {})).toBeNull();
    expect(await acaoFor('http://localhost:5173', undefined)).toBeNull();
    expect(await acaoFor(PAGES, undefined)).toBe(PAGES);
  });

  it('rejects dev origins when ENVIRONMENT is misspelled', async () => {
    expect(await acaoFor('http://localhost:5173', { ENVIRONMENT: 'dev' })).toBeNull();
  });

  it.each([
    ['unknown site', 'https://evil.example.com'],
    ['literal "null" origin (sandboxed iframe / file://)', 'null'],
    ['http downgrade of Pages', 'http://manud.github.io'],
    ['suffix attack', 'https://manud.github.io.evil.com'],
    ['prefix attack', 'https://evilmanud.github.io'],
    ['other github.io user', 'https://attacker.github.io'],
    ['explicit port', 'https://manud.github.io:443'],
    ['trailing slash', 'https://manud.github.io/'],
    ['with path', 'https://manud.github.io/PruebaMapJapan'],
    ['upper-case host', 'https://MANUD.github.io'],
    ['wildcard', '*'],
    ['loopback IP', 'http://127.0.0.1:5173'],
    ['very long origin', 'https://' + 'a'.repeat(10_000) + '.com'],
  ])('rejects %s', async (_label, origin) => {
    expect(await acaoFor(origin, PROD)).toBeNull();
  });

  it('never emits * for an absent Origin header', async () => {
    expect(await acaoFor(null, PROD)).toBeNull();
    expect(await acaoFor(null, DEV)).toBeNull();
  });

  it('preflight from an allowed origin returns 204 with methods/headers', async () => {
    const res = await preflight(PAGES, PROD);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PAGES);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type,Authorization');
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('preflight from localhost in production gets no allow-origin', async () => {
    const res = await preflight('http://localhost:5173', PROD);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('sets Vary: Origin on actual responses so caches do not mix origins', async () => {
    const res = await app.request('/test', { headers: { Origin: PAGES } }, PROD);
    expect(res.headers.get('Vary')).toContain('Origin');
  });
});

describe('CORS middleware — development', () => {
  it.each(['http://localhost:5173', 'http://localhost:3000', PAGES])(
    'reflects %s',
    async (origin) => {
      expect(await acaoFor(origin, DEV)).toBe(origin);
    },
  );

  it('still rejects unknown and "null" origins in development', async () => {
    expect(await acaoFor('https://evil.example.com', DEV)).toBeNull();
    expect(await acaoFor('null', DEV)).toBeNull();
    expect(await acaoFor('http://localhost:8080', DEV)).toBeNull();
  });
});

describe('CORS on the real app', () => {
  const baseEnv: Env = {
    DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb',
    KEYCLOAK_URL: 'http://localhost:8080',
    KEYCLOAK_REALM: 'japan-trip',
    VALID_AUDIENCES: 'japan-trip-frontend',
    KC_ADMIN_CLIENT_ID: 'japan-trip-worker',
    KC_ADMIN_CLIENT_SECRET: 'mock-secret',
    OTP_SECRET: 'x'.repeat(64),
  };

  it('production env: localhost gets no ACAO even on a 401', async () => {
    const res = await realApp.request(
      '/api/trips',
      { headers: { Origin: 'http://localhost:5173' } },
      { ...baseEnv, ENVIRONMENT: 'production' },
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('production env: Pages origin is allowed on the 401 so the SPA can read it', async () => {
    const res = await realApp.request(
      '/api/trips',
      { headers: { Origin: PAGES } },
      { ...baseEnv, ENVIRONMENT: 'production' },
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PAGES);
  });

  it('development env: localhost allowed', async () => {
    const res = await realApp.request(
      '/api/health',
      { headers: { Origin: 'http://localhost:5173' } },
      { ...baseEnv, ENVIRONMENT: 'development' },
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });
});
