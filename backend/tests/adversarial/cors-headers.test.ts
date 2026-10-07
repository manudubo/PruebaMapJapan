/**
 * Adversarial: CORS preflights with odd origins and security headers on
 * every kind of response. No database needed (preflights and 401s never
 * reach it).
 */
import { describe, expect, it } from 'vitest';
import app from '../../src/index';
import { makeEnv } from './harness';

const env = makeEnv('postgresql://unused@127.0.0.1:1/none');
const ALLOWED = 'https://manudubo.github.io';

function preflight(origin: string | null, method = 'POST', headers = 'authorization,content-type') {
  const h: Record<string, string> = {
    'Access-Control-Request-Method': method,
    'Access-Control-Request-Headers': headers,
  };
  if (origin !== null) h.Origin = origin;
  return app.request('https://api.example.test/api/trips', { method: 'OPTIONS', headers: h }, env);
}

describe('CORS preflight', () => {
  it('allowed origin → 204 with exact origin echoed, Authorization allowed, Vary: Origin', async () => {
    const res = await preflight(ALLOWED);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED);
    expect(res.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('authorization');
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it.each([
    ['literal "null" (sandboxed iframe / file://)', 'null'],
    ['suffix attack', 'https://manudubo.github.io.evil.test'],
    ['prefix attack', 'https://evilmanudubo.github.io'],
    ['other github pages user', 'https://attacker.github.io'],
    ['http downgrade', 'http://manudubo.github.io'],
    ['explicit default port', 'https://manudubo.github.io:443'],
    ['trailing slash', 'https://manudubo.github.io/'],
    ['upper-case host', 'https://MANUDUBO.GITHUB.IO'],
    ['userinfo trick', 'https://manudubo.github.io@evil.test'],
    ['wildcard', '*'],
    ['empty string', ''],
    ['header-folding attempt', 'https://evil.test X-Injected: 1'],
    ['punycode homograph', 'https://manudubo.xn--githu-9ua.io'],
  ])('%s → no Access-Control-Allow-Origin', async (_l, origin) => {
    const res = await preflight(origin);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('X-Injected')).toBeNull();
  });

  it('no Origin header → no ACAO and never "*"', async () => {
    const res = await preflight(null);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('never sends Access-Control-Allow-Credentials (bearer tokens only)', async () => {
    const res = await preflight(ALLOWED);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('preflight for a weird method still does not reflect a foreign origin', async () => {
    const res = await preflight('https://evil.test', 'TRACE');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('actual request from a foreign origin: still 401 without token, and no ACAO', async () => {
    const res = await app.request('https://api.example.test/api/trips', { headers: { Origin: 'https://evil.test' } }, env);
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  // SEC-23 (fixed in Phase 26): localhost dev origins used to be allowed in every environment.
  it('SEC-23: localhost origins are not allowed when ENVIRONMENT=production', async () => {
    const prod = makeEnv('postgresql://unused@127.0.0.1:1/none', { ENVIRONMENT: 'production' });
    const res = await app.request(
      '/api/trips',
      { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' } },
      prod,
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('security headers', () => {
  const cases: [string, () => Promise<Response>][] = [
    ['200 health', async () => app.request('https://api.example.test/api/health', {}, env)],
    ['401 unauthenticated', async () => app.request('https://api.example.test/api/trips', {}, env)],
    ['404 unknown route', async () => app.request('https://api.example.test/api/nope', {}, env)],
    ['400 bad slug', async () => app.request('https://api.example.test/api/public/trips/not-a-uuid', {}, env)],
  ];

  it.each(cases)('%s carries CSP, X-Frame-Options, HSTS, Referrer-Policy', async (_l, call) => {
    const res = await call();
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('JSON responses are served as application/json (never sniffable HTML)', async () => {
    const res = await app.request('https://api.example.test/api/nope', {}, env);
    expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
  });

  it('SEC-20: X-Content-Type-Options: nosniff and Permissions-Policy are set', async () => {
    const res = await app.request('https://api.example.test/api/health', {}, env);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Permissions-Policy')).not.toBeNull();
  });

  it('health endpoint does not leak env/config (SEC-24 baseline)', async () => {
    const res = await app.request('https://api.example.test/api/health', {}, env);
    const text = await res.text();
    expect(text).not.toContain('postgresql://');
    expect(text).not.toContain(env.OTP_SECRET);
    expect(text).not.toContain(env.KEYCLOAK_URL);
  });
});
