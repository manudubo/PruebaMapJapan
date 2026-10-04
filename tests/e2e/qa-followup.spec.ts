import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * @qa-noauth — follow-up to .planning/qa/QA-FRONTEND-REPORT.md visual findings 1-4.
 * Needs NO Keycloak and NO backend; Keycloak is black-holed / delayed / broken per test.
 *
 * Run against a PRODUCTION build:
 *   npm run build --workspace=frontend
 *   npm run preview --workspace=frontend            # http://localhost:5173/PruebaMapJapan/
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test qa-followup --grep @qa-noauth --project=chromium
 */

/** Block every external host (tiles, fonts, news, weather); only the app origin is reachable. */
async function blockExternal(target: Page | BrowserContext): Promise<void> {
  await target.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
}

/** Keycloak unreachable: connection refused / DNS failure. */
async function offlineIdp(target: Page | BrowserContext): Promise<void> {
  await target.route(/:8080\//, (r) => r.abort());
}

// ---------------------------------------------------------------------------
// Finding 2: floating search button must not cover content
// ---------------------------------------------------------------------------

const VIEWPORTS = [
  { width: 240, height: 640 },
  { width: 320, height: 640 },
  { width: 375, height: 740 },
  { width: 844, height: 390 }, // landscape phone
  { width: 1280, height: 800 },
  { width: 1440, height: 900 }, // wide: floats in the gutter
];
const LAYOUT_PAGES = ['index.html', 'tokyo.html', 'kyoto.html', 'dashboard.html', 'trip.html?tripId=1'];

/** Visible leaf-ish elements in <main> whose box intersects the search button. */
async function contentUnderSearch(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const wrap = document.querySelector('search-bar')?.shadowRoot?.querySelector('.search-input-wrapper');
    if (!wrap) return ['<search button missing>'];
    const s = wrap.getBoundingClientRect();
    const hits: string[] = [];
    const interesting = new Set(['A', 'BUTTON', 'INPUT', 'H1', 'H2', 'H3', 'P', 'IMG', 'LI', 'SPAN']);
    for (const el of Array.from(document.querySelectorAll('main *'))) {
      if (el.closest('.leaflet-container') && !el.classList.contains('leaflet-container')) continue;
      if (el.children.length && !interesting.has(el.tagName)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < s.right && r.right > s.left && r.top < s.bottom && r.bottom > s.top) {
        hits.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
      }
    }
    return hits;
  });
}

async function searchBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('search-bar .search-input-wrapper').boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

test.describe('@qa-noauth search button layout', () => {
  for (const vp of VIEWPORTS) {
    for (const path of LAYOUT_PAGES) {
      test(`${path} @ ${vp.width}x${vp.height}: no content under the search button, target >= 44px`, async ({ page }) => {
        await page.setViewportSize(vp);
        await offlineIdp(page);
        await blockExternal(page);
        await page.goto(path);
        await expect(page.locator('main h1').first()).toBeVisible();

        const box = await searchBox(page);
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);

        // Check at the top, middle and bottom of the page (a fixed overlay moves with scroll).
        const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
        for (const y of [0, Math.floor(maxScroll / 2), maxScroll]) {
          await page.evaluate((top) => window.scrollTo(0, top), y);
          expect(await contentUnderSearch(page), `scrollY=${y}`).toEqual([]);
        }
        const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        expect(sw).toBeLessThanOrEqual(iw);
      });
    }
  }

  test('RTL at 375px: button mirrors to the inline end (left) and covers nothing', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await offlineIdp(page);
    await blockExternal(page);
    await page.goto('tokyo.html');
    await expect(page.locator('main h1')).toBeVisible();
    // (an init script is too early: the parser replaces <html> attributes)
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    const box = await searchBox(page);
    expect(box.x + box.width / 2).toBeLessThan(375 / 2);
    expect(await contentUnderSearch(page)).toEqual([]);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw).toBeLessThanOrEqual(iw);
  });

  for (const width of [240, 375]) {
    test(`expanded search fits the viewport at ${width}px and still finds results`, async ({ page }) => {
      await page.setViewportSize({ width, height: 640 });
      await offlineIdp(page);
      await blockExternal(page);
      await page.goto('tokyo.html');
      await page.locator('search-bar .search-input').click();
      await page.locator('search-bar .search-input').fill('kyoto');
      await expect(page.locator('search-bar .search-result').first()).toBeVisible();
      const box = await searchBox(page);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      expect(sw).toBeLessThanOrEqual(iw);
    });
  }
});

// ---------------------------------------------------------------------------
// Finding 1: dark-mode landing countdown cards
// ---------------------------------------------------------------------------

test.describe('@qa-noauth dark mode tokens', () => {
  test('landing countdown and city cards are dark in dark mode, light in light mode', async ({ browser }) => {
    for (const scheme of ['dark', 'light'] as const) {
      const ctx = await browser.newContext({ colorScheme: scheme });
      await offlineIdp(ctx);
      await blockExternal(ctx);
      const page = await ctx.newPage();
      await page.goto('index.html');
      const bgLum = await page.locator('.countdown-unit').first().evaluate((el) => {
        const m = getComputedStyle(el).backgroundColor.match(/\d+/g)!.map(Number);
        return (0.2126 * m[0]! + 0.7152 * m[1]! + 0.0722 * m[2]!) / 255;
      });
      const chipLum = await page.locator('#overview-cities .city-card').first().evaluate((el) => {
        const m = getComputedStyle(el).backgroundColor.match(/\d+/g)!.map(Number);
        return (0.2126 * m[0]! + 0.7152 * m[1]! + 0.0722 * m[2]!) / 255;
      });
      if (scheme === 'dark') {
        expect(bgLum).toBeLessThan(0.2);
        expect(chipLum).toBeLessThan(0.2);
      } else {
        expect(bgLum).toBeGreaterThan(0.9);
      }
      await ctx.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Findings 3 + 4: Keycloak slow / down / broken
// ---------------------------------------------------------------------------

type IdpMode = 'anonymous' | 'authenticated' | 'abort' | 'hang' | 'error500';

interface FakeIdp {
  mode: IdpMode;
  /** Delay before answering the first request of each init (slow Keycloak). */
  delayMs: number;
  tokenLifetimeS: number;
  refreshFails: boolean;
  step1Requests: number;
  interactiveLogins: number;
}

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`;
}

/**
 * Minimal fake of the Keycloak endpoints keycloak-js touches for silent check-sso:
 * 3p-cookie iframe, authorize (prompt=none -> redirect to silent-check-sso.html), token.
 * The mode can be switched mid-test to simulate flapping.
 */
async function fakeIdp(target: Page | BrowserContext, init: Partial<FakeIdp> = {}): Promise<FakeIdp> {
  const idp: FakeIdp = {
    mode: 'anonymous', delayMs: 0, tokenLifetimeS: 300, refreshFails: false,
    step1Requests: 0, interactiveLogins: 0, ...init,
  };
  await target.route(/:8080\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith('/3p-cookies/step1.html')) idp.step1Requests++;
    if (idp.mode === 'abort') return route.abort('connectionrefused');
    if (idp.mode === 'hang') return; // black hole: never answered
    if (idp.delayMs && url.pathname.endsWith('/3p-cookies/step1.html')) {
      await new Promise((r) => setTimeout(r, idp.delayMs));
    }
    if (idp.mode === 'error500') {
      return route.fulfill({ status: 500, contentType: 'text/html', body: '<html><body><h1>500 Internal Server Error</h1></body></html>' });
    }
    const cors = {
      'access-control-allow-origin': req.headers()['origin'] ?? '*',
      'access-control-allow-credentials': 'true',
    };
    if (url.pathname.endsWith('/3p-cookies/step1.html')) {
      return route.fulfill({ contentType: 'text/html', body: '<script>parent.postMessage("supported", "*")</script>' });
    }
    if (url.pathname.endsWith('/openid-connect/auth')) {
      if (url.searchParams.get('prompt') !== 'none') {
        idp.interactiveLogins++;
        return route.fulfill({ contentType: 'text/html', body: '<h1>Fake Keycloak login</h1>' });
      }
      const state = url.searchParams.get('state') ?? '';
      const nonce = url.searchParams.get('nonce') ?? '';
      const fragment = idp.mode === 'authenticated'
        ? `state=${state}&session_state=s1&code=${encodeURIComponent(nonce)}`
        : `error=login_required&state=${state}`;
      return route.fulfill({ status: 302, headers: { location: `${url.searchParams.get('redirect_uri')}#${fragment}` } });
    }
    if (url.pathname.endsWith('/openid-connect/token')) {
      const body = new URLSearchParams(req.postData() ?? '');
      if (body.get('grant_type') === 'refresh_token' && idp.refreshFails) {
        return route.fulfill({ status: 400, headers: cors, contentType: 'application/json', body: '{"error":"invalid_grant"}' });
      }
      const now = Math.floor(Date.now() / 1000);
      const claims = { iat: now, exp: now + idp.tokenLifetimeS, sub: 'qa-user-1', sid: 's1', name: 'QA User', preferred_username: 'qa', email: 'qa@example.test' };
      return route.fulfill({
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: jwt(claims),
          refresh_token: jwt({ ...claims, exp: now + 1800 }),
          id_token: jwt({ ...claims, nonce: body.get('code') ?? '' }),
          token_type: 'Bearer',
          expires_in: idp.tokenLifetimeS,
        }),
      });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  return idp;
}

interface FakeApi { tripPosts: number; unauthorized: number }

/** Fake backend at the default VITE_API_URL (http://localhost:8787/api). */
async function fakeApi(page: Page, opts: { postDelayMs?: number } = {}): Promise<FakeApi> {
  const api: FakeApi = { tripPosts: 0, unauthorized: 0 };
  await page.route(/:8787\/api\//, async (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': req.headers()['origin'] ?? '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const auth = req.headers()['authorization'] ?? '';
    if (!auth.startsWith('Bearer ')) {
      api.unauthorized++;
      return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"success":false,"code":"unauthorized"}' });
    }
    const path = new URL(req.url()).pathname.replace(/^.*\/api/, '');
    const json = (data: unknown) => route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    if (path === '/users/me') return json({ id: 1, name: 'QA User', email: 'qa@example.test' });
    if (path === '/trips' && req.method() === 'GET') return json([]);
    if (path === '/trips' && req.method() === 'POST') {
      api.tripPosts++;
      await new Promise((r) => setTimeout(r, opts.postDelayMs ?? 1500));
      return json({ id: 100 + api.tripPosts, name: 'x', destinations: [] });
    }
    if (/^\/trips\/\d+$/.test(path)) return json({ id: Number(path.split('/')[2]), name: 'Created', destinations: [] });
    return route.fulfill({ status: 404, headers: cors, body: '' });
  });
  return api;
}

/** Skip the passkey-registration redirect for the fake user on WebAuthn-capable browsers. */
async function skipPasskeyCampaign(ctx: BrowserContext): Promise<void> {
  await ctx.addCookies([{ name: 'pnk_qa-user-1', value: '1', url: 'http://localhost:4180' }, { name: 'pnk_qa-user-1', value: '1', url: 'http://localhost:5173' }]);
}

const TIMEOUT_MS = 4000; // AUTH_INIT_TIMEOUT_MS in frontend/src/auth/keycloak.ts

test.describe('@qa-noauth landing when Keycloak is unreachable', () => {
  for (const mode of ['abort', 'hang', 'error500'] as const) {
    test(`${mode}: hero renders immediately, notice appears within the bound`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await blockExternal(page);
      await fakeIdp(page, { mode });
      const t0 = Date.now();
      await page.goto('index.html', { waitUntil: 'domcontentloaded' });

      await expect(page.locator('#landing-hero h1')).toBeVisible({ timeout: 1500 });
      await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
      expect(await page.locator('#landing-loading').count()).toBe(0);

      const notice = page.locator('#auth-notice');
      await expect(notice).toBeVisible({ timeout: TIMEOUT_MS + 2000 });
      expect(Date.now() - t0).toBeLessThan(TIMEOUT_MS + 3000);
      await expect(notice).toHaveAttribute('role', 'status');
      await expect(page.locator('#landing-hero')).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test('notice is dismissible and Retry recovers once Keycloak is back', async ({ page }) => {
    await blockExternal(page);
    const idp = await fakeIdp(page, { mode: 'abort' });
    await page.goto('index.html');
    const notice = page.locator('#auth-notice');
    await expect(notice).toBeVisible({ timeout: TIMEOUT_MS + 2000 });

    idp.mode = 'anonymous';
    await notice.getByRole('button', { name: 'Retry' }).click();
    await expect(notice).toBeHidden({ timeout: TIMEOUT_MS + 2000 });

    idp.mode = 'abort';
    await page.reload();
    await expect(page.locator('#auth-notice')).toBeVisible({ timeout: TIMEOUT_MS + 2000 });
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('#auth-notice')).toHaveCount(0);
    await expect(page.locator('#landing-hero')).toBeVisible();
  });

  test('slow Keycloak (answers after the timeout): notice, then late "signed out" clears it', async ({ page }) => {
    await blockExternal(page);
    const idp = await fakeIdp(page, { mode: 'anonymous', delayMs: TIMEOUT_MS + 2000 });
    // The delayed iframe holds the 'load' event past the timeout; don't wait for it.
    await page.goto('index.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#auth-notice')).toBeVisible({ timeout: TIMEOUT_MS + 1500 });
    await expect(page.locator('#auth-notice')).toHaveCount(0, { timeout: 8000 });
    expect(idp.step1Requests).toBe(1); // late resolution: no second init
  });

  test('slow Keycloak with a session: late success still redirects to the dashboard', async ({ page, context }) => {
    await blockExternal(page);
    await skipPasskeyCampaign(context);
    const idp = await fakeIdp(page, { mode: 'authenticated', delayMs: TIMEOUT_MS + 1500 });
    await page.goto('index.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#auth-notice')).toBeVisible({ timeout: TIMEOUT_MS + 1500 });
    await page.waitForURL(/dashboard\.html/, { timeout: 12000 });
    expect(idp.step1Requests).toBeGreaterThanOrEqual(1);
  });

  test('offline: notice without waiting for any timeout', async ({ page }) => {
    await blockExternal(page);
    const idp = await fakeIdp(page, { mode: 'anonymous' });
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    });
    await page.goto('index.html');
    await expect(page.locator('#auth-notice')).toBeVisible({ timeout: 1500 });
    expect(idp.step1Requests).toBe(0);
  });
});

test.describe('@qa-noauth auth-gated pages when Keycloak is unreachable', () => {
  for (const path of ['dashboard.html', 'trip.html?tripId=1', 'profile.html']) {
    test(`${path}: accessible error state with Retry and a way home (no redirect, no endless spinner)`, async ({ page }) => {
      await blockExternal(page);
      await fakeIdp(page, { mode: 'hang' });
      // A black-holed iframe also holds the window 'load' event; don't wait for it.
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      const state = page.locator('#auth-unavailable');
      await expect(state).toBeVisible({ timeout: TIMEOUT_MS + 2000 });
      expect(new URL(page.url()).pathname).toContain(path.split('?')[0]!);

      await expect(state.getByRole('heading', { level: 1, name: "Can't reach the sign-in service" })).toBeVisible();
      await expect(state.getByRole('alert')).toBeVisible();
      await expect(state.getByRole('button', { name: 'Retry' })).toBeVisible();
      await expect(state.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', /index\.html$/);
      await expect(page.locator('#auth-pending')).toHaveCount(0);
      // Exactly one visible h1 (the page's own heading is hidden behind the state).
      const h1s = await page.locator('main h1:visible').count();
      expect(h1s).toBe(1);
      const retry = await state.getByRole('button', { name: 'Retry' }).boundingBox();
      expect(retry!.height).toBeGreaterThanOrEqual(44);
    });
  }

  test('dashboard: the error state is distinct from the sign-in prompt, and Retry reaches the prompt', async ({ page }) => {
    await blockExternal(page);
    const idp = await fakeIdp(page, { mode: 'abort' });
    await page.goto('dashboard.html');
    await expect(page.locator('#auth-unavailable')).toBeVisible({ timeout: TIMEOUT_MS + 2000 });
    await expect(page.locator('#dashboard-login-prompt')).toBeHidden();

    idp.mode = 'anonymous';
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('#dashboard-login-prompt')).toBeVisible({ timeout: TIMEOUT_MS + 2000 });
    await expect(page.locator('#auth-unavailable')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'My Trips' })).toBeVisible();
  });

  test('dashboard: rapid Retry clicks while Keycloak is black-holed start one attempt and never stick', async ({ page }) => {
    await blockExternal(page);
    const idp = await fakeIdp(page, { mode: 'error500' });
    await page.goto('dashboard.html');
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible({ timeout: TIMEOUT_MS + 2000 });
    const before = idp.step1Requests;

    idp.mode = 'hang';
    for (let i = 0; i < 8; i++) await retry.click({ force: true, noWaitAfter: true, timeout: 1000 }).catch(() => {});
    await expect(retry).toBeDisabled();
    await expect(retry).toBeEnabled({ timeout: TIMEOUT_MS + 2000 });
    expect(idp.step1Requests - before).toBeLessThanOrEqual(1);
    await expect(page.locator('.auth-unavailable-status')).toHaveText('Still no response from the sign-in service.');
  });

  test('dashboard: network flapping (down, still down, up) ends in the right state', async ({ page }) => {
    await blockExternal(page);
    const idp = await fakeIdp(page, { mode: 'abort' });
    await page.goto('dashboard.html');
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible({ timeout: TIMEOUT_MS + 2000 });

    await retry.click(); // still down
    await expect(page.locator('.auth-unavailable-status')).toHaveText(/Still no response/, { timeout: TIMEOUT_MS + 2000 });
    await expect(retry).toBeEnabled();

    idp.mode = 'error500';
    await retry.click();
    await expect(page.locator('.auth-unavailable-status')).toHaveText(/Still no response/, { timeout: TIMEOUT_MS + 2000 });

    idp.mode = 'anonymous';
    await retry.click();
    await expect(page.locator('#dashboard-login-prompt')).toBeVisible({ timeout: TIMEOUT_MS + 2000 });
  });

  test('dashboard offline: offline wording, then auto-recovers on the online event', async ({ page }) => {
    await blockExternal(page);
    await fakeIdp(page, { mode: 'anonymous' });
    await page.addInitScript(() => {
      let online = false;
      Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => online });
      (window as unknown as { __goOnline: () => void }).__goOnline = () => {
        online = true;
        window.dispatchEvent(new Event('online'));
      };
    });
    await page.goto('dashboard.html');
    await expect(page.locator('.auth-unavailable-body')).toHaveText(/offline/, { timeout: 1500 });
    await page.evaluate(() => (window as unknown as { __goOnline: () => void }).__goOnline());
    await expect(page.locator('#dashboard-login-prompt')).toBeVisible({ timeout: TIMEOUT_MS + 2000 });
  });

  test('Spanish browser gets Spanish strings with lang="es"', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'es-AR' });
    await blockExternal(ctx);
    await fakeIdp(ctx, { mode: 'abort' });
    const page = await ctx.newPage();
    await page.goto('dashboard.html');
    const state = page.locator('#auth-unavailable');
    await expect(state).toBeVisible({ timeout: TIMEOUT_MS + 2000 });
    await expect(state).toHaveAttribute('lang', 'es');
    await expect(state.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    await expect(state.getByRole('link', { name: 'Volver al inicio' })).toBeVisible();
    await ctx.close();
  });
});

// ---------------------------------------------------------------------------
// Signed-in flows against the fake IdP + fake API (no bypassCSP: the build's CSP
// lists the Keycloak and API origins, so these also prove the policy allows them)
// ---------------------------------------------------------------------------

test.describe('@qa-noauth signed-in dashboard (fake IdP + API)', () => {
  test.beforeEach(async ({ context }) => {
    await skipPasskeyCampaign(context);
  });

  test('slow-then-success on the dashboard: error state, then trips load without a second init', async ({ page }) => {
    await blockExternal(page);
    const idp = await fakeIdp(page, { mode: 'authenticated', delayMs: TIMEOUT_MS + 1500 });
    await fakeApi(page);
    await page.goto('dashboard.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#auth-unavailable')).toBeVisible({ timeout: TIMEOUT_MS + 1500 });
    await expect(page.locator('#auth-unavailable')).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByRole('heading', { level: 1, name: /Hello, QA/ })).toBeVisible();
    await expect(page.locator('#new-trip-btn')).toBeVisible();
    expect(idp.step1Requests).toBe(1);
  });

  async function openCreateForm(page: Page): Promise<FakeApi> {
    await blockExternal(page);
    await fakeIdp(page, { mode: 'authenticated' });
    const api = await fakeApi(page, { postDelayMs: 2000 });
    await page.goto('dashboard.html');
    await page.locator('#new-trip-btn').click();
    await page.locator('#trip-name').fill('Japan 2027');
    return api;
  }

  test('double-clicking "Create trip" creates one trip', async ({ page }) => {
    const api = await openCreateForm(page);
    await page.locator('#create-trip-form [type="submit"]').dblclick();
    await page.locator('#create-trip-form [type="submit"]').click({ force: true, noWaitAfter: true }).catch(() => {});
    await page.waitForURL(/trip\.html\?tripId=101/, { timeout: 8000 });
    expect(api.tripPosts).toBe(1);
  });

  test('Enter-key repeat in the name field creates one trip', async ({ page }) => {
    const api = await openCreateForm(page);
    await page.locator('#trip-name').focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Enter', { delay: 0 });
    await page.waitForURL(/trip\.html\?tripId=101/, { timeout: 8000 });
    expect(api.tripPosts).toBe(1);
  });

  test('token expiry mid-session with Keycloak refresh failing: no crash, user is sent to sign in', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await blockExternal(page);
    const idp = await fakeIdp(page, { mode: 'authenticated', tokenLifetimeS: 120 });
    const api = await fakeApi(page, { postDelayMs: 0 });
    await page.clock.install();
    await page.goto('dashboard.html');
    await expect(page.locator('#new-trip-btn')).toBeVisible();
    expect(idp.interactiveLogins).toBe(0);

    // Keycloak goes down, then the access token expires: onTokenExpired's refresh fails quietly.
    idp.refreshFails = true;
    await page.clock.fastForward('03:00');
    await page.locator('#new-trip-btn').click();
    await page.locator('#trip-name').fill('After expiry');
    await page.locator('#create-trip-form [type="submit"]').click();

    // The API rejects the unauthenticated call and the app starts an interactive login.
    await expect.poll(() => idp.interactiveLogins, { timeout: 8000 }).toBeGreaterThanOrEqual(1);
    expect(api.tripPosts).toBe(0);
    expect(errors).toEqual([]);
  });
});
