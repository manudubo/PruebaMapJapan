import { devices, expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { layoutProblems } from './fixtures/idp-theme/mobile-checks';
import { openSnapshot, ROOT, SCREENS, SNAPSHOTS } from './fixtures/idp-theme/snapshot-server';

/**
 * REGRESSION: a real iPhone showed the login page as a card inside a card inside a card, running
 * past the right edge, with Keycloak's raw error text.
 *
 * Cause: Keycloak serves theme files from /auth/resources/<keycloak-version-hash>/login/<theme>/...
 * with "Cache-Control: max-age=2592000" (30 days) in production (theme caching is on; start-dev
 * turns it off, which is why no earlier test, all against a dev Keycloak or fresh browser, saw it).
 * The URL does not change when the theme does, so a browser that had loaded the old theme's
 * css/login.css kept using it for up to a month with the new markup.
 * Fix: every stylesheet/script URL carries ?v=<hash of resources/> (template.ftl, theme.properties
 * jpAssetVersion; `node tests/e2e/fixtures/idp-theme/asset-version.mjs --write` after editing a
 * resource file), so a changed file is a new URL and bypasses the cache.
 */
const LOGIN = path.join(ROOT, 'keycloak/themes/japan-trip/login');
const read = (f: string) => fs.readFileSync(path.join(LOGIN, f), 'utf8');
// asset-version.mjs is a plain node script (also the --write tool): run it rather than import it.
const computeAssetVersion = () => execFileSync('node', [path.join(SNAPSHOTS, 'asset-version.mjs')], { encoding: 'utf8' }).trim();
const recordedAssetVersion = () => /^jpAssetVersion=(\S+)$/m.exec(read('theme.properties'))?.[1] ?? null;

test.describe('theme assets are cache-busted', () => {
  test('theme.properties records the hash of resources/ (run asset-version.mjs --write after editing them)', () => {
    expect(recordedAssetVersion(), 'jpAssetVersion in theme.properties').toBe(computeAssetVersion());
  });

  test('template.ftl versions every stylesheet and script it references from the theme', () => {
    const template = read('template.ftl');
    for (const re of [/\$\{url\.resourcesPath\}\/\$\{style\}\?v=\$\{properties\.jpAssetVersion/, /\$\{url\.resourcesPath\}\/\$\{script\}\?v=\$\{properties\.jpAssetVersion/, /js\/passkey-first\.js\?v=\$\{properties\.jpAssetVersion/]) {
      expect(template).toMatch(re);
    }
    // No theme file by a bare URL (the Keycloak-owned menu-button-links.js / authChecker.js are not ours).
    const bare = [...template.matchAll(/resourcesPath\}\/(?:js|css)\/([\w.-]+)"/g)].map((m) => m[1]).filter((f) => f && fs.existsSync(path.join(LOGIN, 'resources/js', f)));
    expect(bare, 'theme scripts referenced without ?v=').toEqual([]);
    expect(read('webauthn-register.ftl')).toMatch(/passkey-label\.js\?v=\$\{properties\.jpAssetVersion/);
  });

  for (const screen of SCREENS) {
    test(`${screen}: the served page asks for the stylesheet with a ?v= token`, () => {
      const html = fs.readFileSync(path.join(SNAPSHOTS, `${screen}.html`), 'utf8');
      const hrefs = [...html.matchAll(/(?:href|src)="([^"]*\/login\/japan-trip\/(?:css|js)\/[^"]+)"/g)].map((m) => m[1]!);
      expect(hrefs.some((h) => h.includes('/css/login.css')), 'login.css is linked').toBe(true);
      for (const href of hrefs) expect(href, 'theme asset URL').toMatch(/\?v=[0-9a-z]+$/);
    });
  }
});

const { defaultBrowserType: _engine, ...IPHONE } = devices['iPhone 13'];

test.describe('a phone that cached the old stylesheet (dark, 390px)', () => {
  test.use({ ...IPHONE, viewport: { width: 390, height: 844 }, colorScheme: 'dark', storageState: { cookies: [], origins: [] } });

  for (const screen of ['username', 'password', 'error', 'error-expired']) {
    test(`${screen}: the new page still draws correctly, because its stylesheet URL is new`, async ({ page }) => {
      await openSnapshot(page, screen, { staleCss: true });
      expect(await layoutProblems(page)).toEqual([]);
    });
  }

  // The audit is only worth anything if it sees the screenshot from the bug report.
  test('the audit flags the old stylesheet on the new markup (the reported screenshot)', async ({ page }) => {
    await openSnapshot(page, 'username', { staleCss: true, ignoreVersion: true });
    const problems = await layoutProblems(page);
    expect(problems.join('\n')).toMatch(/extends past the viewport|scrolls sideways/);
    expect(problems.join('\n')).toMatch(/nested (bordered|filled) container|sticks out of the card padding|indented/);
  });
});

// Against a real Keycloak (see keycloak-flow.sh; production serves it under /auth, so
// KEYCLOAK_URL=http://localhost:8080/auth matches): what the server really links.
test.describe('live Keycloak', () => {
  const KEYCLOAK_URL = process.env['KEYCLOAK_URL'] ?? 'http://localhost:8080';
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the login page links the stylesheet with ?v=, and that URL serves the current file', async ({ request }) => {
    const page = await request.get(`${KEYCLOAK_URL}/realms/japan-trip/protocol/openid-connect/auth?client_id=japan-trip-frontend&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2FPruebaMapJapan%2Fdashboard.html&response_type=code&scope=openid&ui_locales=en&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256`, { timeout: 5000 }).catch(() => null);
    test.fixme(!page?.ok(), 'requires a Keycloak with the japan-trip realm (scripts/ci/keycloak-flow.sh)');
    const html = await page!.text();
    const href = /<link href="([^"]*japan-trip\/css\/login\.css\?v=[0-9a-f]+)"/.exec(html)?.[1];
    expect(href, 'login.css link with ?v=').toBeTruthy();
    expect(href).toContain(`?v=${computeAssetVersion()}`);
    const css = await request.get(new URL(href!, KEYCLOAK_URL).toString());
    expect(css.status()).toBe(200);
    expect(css.headers()['content-type']).toContain('text/css');
    expect(await css.text()).toBe(fs.readFileSync(path.join(LOGIN, 'resources/css/login.css'), 'utf8'));
  });
});
