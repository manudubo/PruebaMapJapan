import { test, expect, type Page } from '@playwright/test';
import { mockKeycloakLoggedIn, mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import { mockApi, type ApiCall } from './fixtures/mockApi';
import { stubMapThirdParty, stubWidgetApis } from './fixtures/mockThirdParty';
import { mockTrip } from './fixtures/mockTrip';

// SEC-04 follow-up (20-CSP-FOLLOWUP.md). The build injects a CSP <meta> into every page.
// It used to omit the API origin from connect-src, so an enforcing browser blocked every
// trip fetch. This spec runs with the CSP ENFORCED (no bypassCSP): the API, Keycloak and
// third parties are mocked at the network layer, which the browser only reaches after the
// policy has allowed the request. Any securitypolicyviolation, or a console report of a
// blocked request or an ignored/invalid source, fails the test.

const API_ORIGIN = new URL(process.env.VITE_API_URL ?? 'http://localhost:8787/api').origin;
const KEYCLOAK_ORIGIN = new URL(process.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8080').origin;

const CITY_PAGES = ['tokyo', 'nagoya', 'takayama', 'kyoto', 'osaka', 'naoshima', 'hakone', 'tokyo2'];

test.use({ storageState: { cookies: [], origins: [] } });

interface CspProbe {
  violations: () => Promise<string[]>;
  apiCalls: ApiCall[];
}

async function armPage(page: Page, auth: 'in' | 'out'): Promise<CspProbe> {
  const consoleReports: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|violates the following|Refused to/i.test(msg.text())) consoleReports.push(msg.text());
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__cspViolations.push(`${e.effectiveDirective} blocked ${e.blockedURI} (${e.sourceFile}:${e.lineNumber})`);
    });
  });
  if (auth === 'in') await mockKeycloakLoggedIn(page);
  else await mockKeycloakLoggedOut(page);
  const apiCalls = await mockApi(page);
  await stubMapThirdParty(page);
  await stubWidgetApis(page);

  return {
    apiCalls,
    violations: async () => {
      const fromEvents = await page.evaluate(
        () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
      );
      return [...fromEvents, ...consoleReports];
    },
  };
}

async function expectPolicyInPage(page: Page): Promise<void> {
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'none'");
  const connectSrc = csp!.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src ')) ?? '';
  expect(connectSrc.split(' ')).toContain(API_ORIGIN);
  expect(connectSrc.split(' ')).toContain(KEYCLOAK_ORIGIN);
}

async function expectMapAndWidgets(page: Page): Promise<void> {
  // Bundled Leaflet JS + CSS: tiles are placed (and load) only when leaflet.css applies.
  await expect(page.locator('#map.leaflet-container')).toBeVisible();
  await expect(page.locator('#map img.leaflet-tile-loaded').first()).toBeVisible();
  await expect(page.locator('#map .leaflet-pane').first()).toHaveCSS('position', 'absolute');
  await expect(page.locator('#map .leaflet-marker-icon').first()).toBeVisible();
}

test.describe('Content-Security-Policy is enforced without violations', () => {
  test('index.html (guest landing)', async ({ page }) => {
    const probe = await armPage(page, 'out');
    await page.goto('index.html');
    await expect(page.locator('#landing-hero')).toBeVisible();
    await expectPolicyInPage(page);
    await page.waitForLoadState('networkidle');
    expect(await probe.violations()).toEqual([]);
  });

  for (const city of CITY_PAGES) {
    test(`${city}.html renders map and widgets`, async ({ page }) => {
      const probe = await armPage(page, 'out');
      await page.goto(`${city}.html`);
      await expectPolicyInPage(page);
      await expectMapAndWidgets(page);
      // Weather (Open-Meteo) and news (RSS proxy) fetches passed connect-src. The widgets
      // load lazily once scrolled into view.
      await page.locator('.widgets-section').scrollIntoViewIfNeeded();
      await expect(page.locator('#widget-weather .weather-temp')).toHaveText('12°');
      await expect(page.locator('#widget-news .widget-link').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await probe.violations()).toEqual([]);
    });
  }

  test('dashboard.html loads trips from the API', async ({ page }) => {
    const probe = await armPage(page, 'in');
    await page.goto('dashboard.html');
    await expectPolicyInPage(page);
    // Only reachable if connect-src allows the API origin.
    await expect(page.locator('.trip-card')).toHaveCount(1);
    await expect(page.locator('.trip-card').first()).toContainText(mockTrip.name);
    expect(probe.apiCalls.some((c) => c.method === 'GET' && c.path === '/trips')).toBe(true);
    await page.waitForLoadState('networkidle');
    expect(await probe.violations()).toEqual([]);
  });

  test('trip.html loads a trip from the API and renders its map', async ({ page }) => {
    const probe = await armPage(page, 'in');
    await page.goto(`trip.html?tripId=${mockTrip.id}`);
    await expectPolicyInPage(page);
    await expect(page.locator('#trip-title')).toHaveText(mockTrip.name);
    await expectMapAndWidgets(page);
    expect(probe.apiCalls.some((c) => c.path === `/trips/${mockTrip.id}`)).toBe(true);
    await page.waitForLoadState('networkidle');
    expect(await probe.violations()).toEqual([]);
  });

  test('trip-edit.html loads the trip into the editor', async ({ page }) => {
    const probe = await armPage(page, 'in');
    await page.goto(`trip-edit.html?tripId=${mockTrip.id}`);
    await expectPolicyInPage(page);
    await expect(page.locator('#trip-name')).toHaveValue(mockTrip.name);
    await page.waitForLoadState('networkidle');
    expect(await probe.violations()).toEqual([]);
  });

  test('profile.html reaches the API and the Keycloak account API', async ({ page }) => {
    const probe = await armPage(page, 'in');
    const accountCall = page.waitForRequest(/\/realms\/[^/]+\/account\/credentials/);
    await page.goto('profile.html');
    await expectPolicyInPage(page);
    // "Test" (first name) only comes from GET /users/me; the token carries "Test User".
    await expect(page.locator('#profile-name')).toHaveText('Test');
    await accountCall;
    await page.waitForLoadState('networkidle');
    expect(await probe.violations()).toEqual([]);
  });

  test('service worker registers under worker-src', async ({ page }) => {
    const probe = await armPage(page, 'out');
    await page.goto('index.html');
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toMatch(/\/PruebaMapJapan\/$/);
    expect(await probe.violations()).toEqual([]);
  });
});
