import { describe, it, expect, vi, afterEach } from 'vitest';
import { keycloakBaseUrl } from '@/auth/keycloak';

// Single-host mode serves Keycloak under a path (KC_HTTP_RELATIVE_PATH=/auth):
// keycloak-js builds every endpoint as `${url}/realms/${realm}/…`, so the
// configured base must keep the path and lose trailing slashes.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('keycloakBaseUrl', () => {
  it.each([
    [undefined, 'http://localhost:8080'],
    ['https://auth.example.org', 'https://auth.example.org'],
    ['https://box.tail1234.ts.net/auth', 'https://box.tail1234.ts.net/auth'],
    ['https://box.tail1234.ts.net/auth/', 'https://box.tail1234.ts.net/auth'],
    [' https://box.tail1234.ts.net/auth// ', 'https://box.tail1234.ts.net/auth'],
  ])('%j → %j', (raw, out) => {
    expect(keycloakBaseUrl(raw)).toBe(out);
  });

  it('the module-level base keeps the /auth path from VITE_KEYCLOAK_URL', async () => {
    vi.stubEnv('VITE_KEYCLOAK_URL', 'https://box.tail1234.ts.net/auth/');
    const mod = await import('@/auth/keycloak');
    expect(mod.KEYCLOAK_URL).toBe('https://box.tail1234.ts.net/auth');
  });
});
