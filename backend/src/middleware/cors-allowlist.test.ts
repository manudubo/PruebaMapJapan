/**
 * ALLOWED_ORIGINS (production CORS allow-list from env, SEC-23 follow-through).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { corsMiddleware, originPolicy, PREFLIGHT_MAX_AGE_S } from './cors';
import { PAGES_ORIGIN as PAGES } from '../config/deploy-defaults';

type Bindings = { ENVIRONMENT?: string; ALLOWED_ORIGINS?: string };
const app = new Hono<{ Bindings: Bindings }>();
app.use('*', corsMiddleware);
app.get('/t', (c) => c.json({ ok: true }));

const acao = async (origin: string, env: Bindings) =>
  (await app.request('/t', { headers: { Origin: origin } }, env)).headers.get('Access-Control-Allow-Origin');

describe('ALLOWED_ORIGINS from env', () => {
  it('unset → the Pages origin from config/deploy-defaults.json', async () => {
    expect(PAGES).toBe('https://manudubo.github.io');
    expect(await acao(PAGES, { ENVIRONMENT: 'production' })).toBe(PAGES);
  });

  it('accepts https://manudubo.github.io and a second exact origin (whitespace tolerated)', async () => {
    const env = { ENVIRONMENT: 'production', ALLOWED_ORIGINS: ' https://manudubo.github.io , https://app.example.net ' };
    expect(await acao('https://manudubo.github.io', env)).toBe('https://manudubo.github.io');
    expect(await acao('https://app.example.net', env)).toBe('https://app.example.net');
  });

  it('a configured list replaces the default (Pages is not implicitly kept)', async () => {
    expect(await acao(PAGES, { ENVIRONMENT: 'production', ALLOWED_ORIGINS: 'https://app.example.net' })).toBeNull();
  });

  it('empty value allows no browser origin at all', async () => {
    expect(await acao(PAGES, { ENVIRONMENT: 'production', ALLOWED_ORIGINS: '' })).toBeNull();
    expect(await acao(PAGES, { ENVIRONMENT: 'production', ALLOWED_ORIGINS: ' , ,' })).toBeNull();
  });

  it.each([
    ['wildcard', '*'],
    ['null', 'null'],
    ['trailing slash', 'https://manudubo.github.io/'],
    ['path', 'https://manudubo.github.io/PruebaMapJapan/'],
    ['plain http in production', 'http://manudubo.github.io'],
    ['localhost http in production', 'http://localhost:5173'],
    ['upper case', 'https://MANUDUBO.github.io'],
    ['default port spelled out', 'https://manudubo.github.io:443'],
    ['userinfo', 'https://x@manudubo.github.io'],
    ['not a URL', 'manudubo.github.io'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['regex-looking', 'https://.*\\.github\\.io'],
  ])('invalid configured entry (%s) is dropped, never widened', async (_l, entry) => {
    const { origins, rejected } = originPolicy('production', entry);
    expect(origins).toEqual([]);
    expect(rejected).toEqual([entry]);
    let value: string | null;
    try {
      value = await acao(entry, { ENVIRONMENT: 'production', ALLOWED_ORIGINS: entry });
    } catch {
      value = null;
    }
    expect(value).toBeNull();
  });

  it('a bad entry does not disable the good ones next to it', () => {
    expect(originPolicy('production', '*,https://manudubo.github.io,null').origins).toEqual([
      'https://manudubo.github.io',
    ]);
  });

  it('development adds localhost on top; http loopback entries only allowed there', () => {
    expect(originPolicy('development', 'http://localhost:4173').origins).toEqual([
      'http://localhost:4173',
      'http://localhost:3000',
      'http://localhost:5173',
    ]);
    expect(originPolicy('production', 'http://localhost:4173').origins).toEqual([]);
  });

  it.each([
    ['suffix look-alike', 'https://manudubo.github.io.evil.test'],
    ['prefix look-alike', 'https://xmanudubo.github.io'],
    ['subdomain', 'https://evil.manudubo.github.io'],
    ['http downgrade', 'http://manudubo.github.io'],
    ['port', 'https://manudubo.github.io:8443'],
    ['path', 'https://manudubo.github.io/PruebaMapJapan'],
    ['null', 'null'],
    ['case', 'https://Manudubo.github.io'],
    ['trailing dot', 'https://manudubo.github.io.'],
    ['embedded space', 'https://manudubo.github.io evil'],
  ])('with the production list, %s is rejected', async (_l, origin) => {
    const env = { ENVIRONMENT: 'production', ALLOWED_ORIGINS: 'https://manudubo.github.io' };
    let value: string | null;
    try {
      value = await acao(origin, env);
    } catch {
      value = null; // the Request constructor refused the header value
    }
    expect(value).toBeNull();
  });

  it('logs invalid entries once as a structured error, not per request', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { ENVIRONMENT: 'production', ALLOWED_ORIGINS: 'https://ok.example, https://bad.example/once' };
    for (let i = 0; i < 20; i++) expect(await acao('https://ok.example', env)).toBe('https://ok.example');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain('cors.invalid_allowed_origins');
    spy.mockRestore();
  });

  it('credentials mode is never enabled; preflight cached for at most 2 h', async () => {
    const res = await app.request(
      '/t',
      { method: 'OPTIONS', headers: { Origin: PAGES, 'Access-Control-Request-Method': 'POST' } },
      { ENVIRONMENT: 'production' },
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(res.headers.get('Access-Control-Max-Age')).toBe(String(PREFLIGHT_MAX_AGE_S));
    expect(PREFLIGHT_MAX_AGE_S).toBeLessThanOrEqual(7200);
  });

  it('a disallowed preflight still gets no ACAO and no credentials', async () => {
    const res = await app.request(
      '/t',
      { method: 'OPTIONS', headers: { Origin: 'https://evil.test', 'Access-Control-Request-Method': 'DELETE' } },
      { ENVIRONMENT: 'production' },
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('exposes Retry-After and X-Request-Id to the SPA', async () => {
    const res = await app.request('/t', { headers: { Origin: PAGES } }, { ENVIRONMENT: 'production' });
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Request-Id');
  });

  it('wrangler.toml production list is exactly the shared Pages origin', () => {
    const toml = readFileSync(resolve(__dirname, '../../wrangler.toml'), 'utf8');
    expect(toml).toMatch(new RegExp(`^ALLOWED_ORIGINS = "${PAGES.replace(/\./g, '\\.')}"$`, 'm'));
  });
});
