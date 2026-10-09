import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Serves a captured real-Keycloak page (fixtures/idp-theme/<screen>.html, see capture.mjs) at
 * http://idp.test/<screen>.html with the theme's real resources from keycloak/themes/japan-trip.
 *
 * `staleCss`: models a browser that already holds the OLD theme's login.css in its HTTP cache.
 * Keycloak serves theme files with "Cache-Control: max-age=2592000" (30 days) from a URL that
 * does not change when the theme does, and the cache key is the full URL: so a page that asks for
 * the stylesheet by its unchanged URL gets the old file, and a page that asks for a URL carrying a
 * new ?v= token goes to the network and gets the new one. `ignoreVersion` serves the old file for
 * both (what the page would look like if the URL had not changed: the bug report's screenshot).
 */
export const ORIGIN = 'http://idp.test';
export const ROOT = path.resolve(__dirname, '../../../..');
export const THEME_RESOURCES = path.join(ROOT, 'keycloak/themes/japan-trip/login/resources');
export const SNAPSHOTS = __dirname;
export const SCREENS = [
  'username',
  'password',
  'password-error',
  'register',
  'webauthn-register',
  'update-password-error',
  'error',
  'error-client',
  'error-expired',
  'info',
] as const;

const TYPES: Record<string, string> = { '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.js': 'text/javascript' };

export async function openSnapshot(page: Page, screen: string, opts: { staleCss?: boolean; ignoreVersion?: boolean } = {}): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    let file: string;
    if (url.pathname.startsWith('/resources/login/japan-trip/')) {
      const rel = url.pathname.replace('/resources/login/japan-trip/', '');
      file = opts.staleCss && rel === 'css/login.css' && (opts.ignoreVersion || !url.searchParams.has('v')) ? path.join(SNAPSHOTS, 'stale-login.css') : path.join(THEME_RESOURCES, rel);
    } else {
      file = path.join(SNAPSHOTS, url.pathname.slice(1));
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] ?? 'text/plain' });
  });
  // The web font is the one thing fetched from outside; the metric-matched fallback stands in.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(`${ORIGIN}/${screen}.html`);
  await page.waitForLoadState('domcontentloaded');
  // The server renders the passkey button hidden and js/passkey-first.js shows it on a browser with
  // WebAuthn (the snapshots have no scripts): show it, as the phone in the bug report did.
  await page.evaluate(() => document.getElementById('jp-passkey-alt')?.removeAttribute('hidden'));
}
