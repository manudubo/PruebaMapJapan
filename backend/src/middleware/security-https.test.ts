import { describe, expect, it } from 'vitest';
import app from '../index';
import { HSTS } from './security';
import { TEST_ENV } from '../auth/jwt-test-fixtures';

const hsts = async (url: string, env: Record<string, string> = {}, headers: Record<string, string> = {}) =>
  (await app.request(url, { headers }, { ...TEST_ENV, ...env })).headers.get('strict-transport-security');

describe('HSTS only behind HTTPS', () => {
  it('https request URL (Workers) → HSTS', async () => {
    expect(await hsts('https://api.example.test/api/health')).toBe(HSTS);
  });

  it('plain http without trusted proxies → no HSTS, even if the client claims https', async () => {
    expect(await hsts('http://localhost:8787/api/health')).toBeNull();
    expect(await hsts('http://localhost:8787/api/health', {}, { 'X-Forwarded-Proto': 'https' })).toBeNull();
  });

  it('behind trusted proxies, X-Forwarded-Proto from the closest proxy decides', async () => {
    const env = { TRUSTED_PROXY_HOPS: '2' };
    expect(await hsts('http://backend:8787/api/health', env, { 'X-Forwarded-Proto': 'https' })).toBe(HSTS);
    // Client-spoofed left part ignored: the right-most value (closest proxy) is http.
    expect(await hsts('http://backend:8787/api/health', env, { 'X-Forwarded-Proto': 'https, http' })).toBeNull();
    expect(await hsts('http://backend:8787/api/health', env)).toBeNull();
  });
});

describe('API response hardening', () => {
  it('strict CSP: nothing loads, nothing frames, sandboxed', async () => {
    const res = await app.request('https://api.example.test/api/health', {}, TEST_ENV);
    const csp = res.headers.get('content-security-policy')!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('sandbox');
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('server')).toBeNull();
  });

  it('responses to authenticated requests are not cacheable', async () => {
    const res = await app.request('https://api.example.test/api/trips', { headers: { Authorization: 'Bearer x' } }, TEST_ENV);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('every response carries a server-generated X-Request-Id', async () => {
    const a = await app.request('https://api.example.test/nope', {}, TEST_ENV);
    const b = await app.request('https://api.example.test/nope', {}, TEST_ENV);
    expect(a.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.headers.get('x-request-id')).not.toBe(b.headers.get('x-request-id'));
  });
});
