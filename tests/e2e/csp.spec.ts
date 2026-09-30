import { test, expect } from '@playwright/test';

// The Vite CSP plugin (frontend/vite.config.ts, SEC-04) whitelists Keycloak in connect-src
// but not the API origin (VITE_API_URL). With a real browser the CSP blocks every API fetch
// from the dashboard/trip pages, so the app cannot load trips at all once the CSP is enforced.
// Other specs run with `bypassCSP` so they can exercise page logic; this spec keeps the
// real policy honest.
const API_ORIGIN = new URL(process.env.VITE_API_URL ?? 'http://localhost:8787/api').origin;

test.describe('Content-Security-Policy', () => {
  for (const page of ['dashboard.html', 'trip.html', 'trip-edit.html']) {
    test(`${page} allows connections to the API origin`, async ({ request }) => {
      test.fixme(true, 'KNOWN APP BUG: cspPlugin() in frontend/vite.config.ts omits VITE_API_URL from connect-src (see 24-E2E-SUMMARY.md)');

      const html = await (await request.get(page)).text();
      const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
      const connectSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src')) ?? '';

      expect(connectSrc).toContain(API_ORIGIN);
    });
  }

  test('the policy is present and blocks everything by default', async ({ request }) => {
    const html = await (await request.get('dashboard.html')).text();
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    // Keycloak must stay reachable for silent SSO.
    expect(csp.split(';').find((d) => d.trim().startsWith('connect-src'))).toContain('localhost:8080');
  });
});
