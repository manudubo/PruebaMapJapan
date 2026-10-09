import { devices, expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

  // RESIDUAL GAP: passkey-first.js imports ./passkey-device.js and ./passkey-webauthn.js by a bare
  // relative URL; the browser would request them without ?v= and keep a stale copy for 30 days after
  // an edit. template.ftl maps each module listed in theme.properties (jpModules) to its versioned URL
  // in the import map.
  test('every ES module a theme script imports has an import-map entry (jpModules)', () => {
    const jsDir = path.join(LOGIN, 'resources/js');
    const listed = (/^jpModules=(.*)$/m.exec(read('theme.properties'))?.[1] ?? '').split(/\s+/).filter(Boolean);
    const IMPORT = /(?:\bimport\s*(?:[\w*{}\s,]*?\bfrom\s*)?|\bexport\s*[\w*{}\s,]*?\bfrom\s*|\bimport\s*\(\s*)(['"`])([^'"`]+)\1/g;
    const needed = new Set<string>();
    for (const f of fs.readdirSync(jsDir).filter((n) => n.endsWith('.js'))) {
      for (const m of fs.readFileSync(path.join(jsDir, f), 'utf8').matchAll(IMPORT)) {
        const spec = m[2]!;
        if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(spec)) continue; // absolute URLs are not ours
        expect(spec, `${f}: import "${spec}" must be a relative path to a theme file (bare names resolve through the import map)`).toMatch(/^\.{1,2}\//);
        const target = path.relative(path.join(LOGIN, 'resources'), path.resolve(jsDir, spec)).split(path.sep).join('/');
        expect(fs.existsSync(path.join(LOGIN, 'resources', target)), `${f} imports ${spec}: no such theme file`).toBe(true);
        needed.add(target);
      }
    }
    // Inline module scripts in the templates that import a theme file by URL.
    for (const t of fs.readdirSync(LOGIN).filter((n) => n.endsWith('.ftl'))) {
      for (const m of read(t).matchAll(/\bimport\b[^;"']*?from\s*"\$\{url\.resourcesPath\}\/([\w./-]+)"|\bimport\(\s*"\$\{url\.resourcesPath\}\/([\w./-]+)"/g)) {
        const target = (m[1] ?? m[2])!;
        if (fs.existsSync(path.join(LOGIN, 'resources', target))) needed.add(target);
      }
    }
    expect([...needed].sort(), 'imported theme modules').not.toEqual([]);
    expect([...needed].filter((n) => !listed.includes(n)).sort(), 'imported by a theme script but missing from jpModules in theme.properties').toEqual([]);
    expect(listed.filter((n) => !needed.has(n)), 'listed in jpModules but never imported').toEqual([]);
    expect(read('template.ftl')).toMatch(/<script type="importmap">[\s\S]*<#list properties\.jpModules\?split\(' '\) as module>[\s\S]*\$\{url\.resourcesPath\}\/\$\{module\}\?v=\$\{properties\.jpAssetVersion/);
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

// A browser with an import map, as a request log: editing an imported module must change the URL requested.
test.describe('imported modules are requested with the version of resources/', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  const BASE = '/resources/login/japan-trip';

  /** template.ftl's import map with its few FreeMarker expressions evaluated (a list, two variables). */
  function renderedImportMap(version: string, withModules = true): string {
    const block = /<script type="importmap">([\s\S]*?)<\/script>/.exec(read('template.ftl'))![1]!;
    const modules = (/^jpModules=(.*)$/m.exec(read('theme.properties'))?.[1] ?? '').split(/\s+/).filter(Boolean);
    const expand = (t: string) => t.replace(/\$\{url\.resourcesCommonPath\}/g, '/common').replace(/\$\{url\.resourcesPath\}/g, BASE).replace(/\$\{properties\.jpAssetVersion!\}/g, version);
    const out = block
      .replace(/<#if [^>]*>(<#list [^>]*>)([\s\S]*?)<\/#list><\/#if>/, (_m, _l, body: string) => (withModules ? modules.map((m) => expand(body.replace(/\$\{module\}/g, m))).join('') : ''))
      .replace(/\$\{module\}/g, '');
    const rendered = expand(out);
    expect(rendered, 'FreeMarker left unevaluated').not.toMatch(/<#|\$\{/);
    return `<script type="importmap">${rendered}</script>`;
  }

  async function visit(page: import('@playwright/test').Page, resources: string, version: string, withModules = true): Promise<string[]> {
    const requested: string[] = [];
    await page.route('http://idp.test/**', (route) => {
      const url = new URL(route.request().url());
      requested.push(url.pathname.replace(BASE, '') + url.search);
      if (url.pathname === '/page.html') {
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>t</title>${renderedImportMap(version, withModules)}<script type="module" src="${BASE}/js/passkey-first.js?v=${version}"></script>` });
      }
      const file = path.join(resources, url.pathname.replace(`${BASE}/`, ''));
      return fs.existsSync(file) ? route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(file) }) : route.fulfill({ status: 404, body: '' });
    });
    await page.goto('http://idp.test/page.html');
    await expect.poll(() => requested.filter((r) => r.startsWith('/js/passkey-')).length).toBeGreaterThanOrEqual(3);
    return requested.filter((r) => r.startsWith('/js/'));
  }

  test('editing passkey-device.js or passkey-webauthn.js changes the URL the browser requests', async ({ browser }) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-theme-'));
    try {
      const copy = path.join(tmp, 'resources');
      fs.cpSync(path.join(LOGIN, 'resources'), copy, { recursive: true });
      const hash = () => execFileSync('node', [path.join(SNAPSHOTS, 'asset-version.mjs'), '--root', copy], { encoding: 'utf8' }).trim();
      const seen: Record<string, string[]> = {};
      for (const [step, edited] of [['v1', ''], ['v2', 'passkey-device.js'], ['v3', 'passkey-webauthn.js']] as const) {
        if (edited) fs.appendFileSync(path.join(copy, 'js', edited), `\n// edited for ${step}\n`);
        const version = hash();
        const context = await browser.newContext();
        const requests = await visit(await context.newPage(), copy, version);
        await context.close();
        for (const mod of ['passkey-device.js', 'passkey-webauthn.js']) {
          expect(requests, `${step}: ${mod} requested with the current version`).toContain(`/js/${mod}?v=${version}`);
          expect(requests.filter((r) => r.startsWith(`/js/${mod}`) && !r.endsWith(`?v=${version}`)), `${step}: ${mod} requested by a bare URL`).toEqual([]);
        }
        seen[step] = [version];
      }
      expect(new Set(Object.values(seen).flat()).size, 'each edit produced a new version').toBe(3);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('control: without the map entries the modules are requested by a bare URL (the bug)', async ({ browser }) => {
    const context = await browser.newContext();
    const requests = await visit(await context.newPage(), path.join(LOGIN, 'resources'), 'abc123', false);
    await context.close();
    expect(requests).toContain('/js/passkey-device.js');
    expect(requests.some((r) => r.includes('passkey-device.js?v='))).toBe(false);
  });
});
