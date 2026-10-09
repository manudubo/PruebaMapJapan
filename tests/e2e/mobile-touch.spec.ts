import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './fixtures/mockApi';
import { mockKeycloakLoggedIn, mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import { stubMapThirdParty } from './fixtures/mockThirdParty';
import { mockTripStore } from './fixtures/mockTripStore';
import { mockTripsBackend } from './fixtures/mockSearchTrips';
import { openEditorAt, mobileTrip } from './fixtures/mobileScreens';
import { phoneViewport } from './fixtures/mobile';

/**
 * MOBILE-COVERAGE.md, "touch" columns: the journeys a phone user actually performs, driven with
 * taps (page.tap / locator.tap) and, where Playwright allows, real touch gestures over CDP.
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test mobile-touch --project=mobile
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }) => {
  await page.setViewportSize(phoneViewport(390));
});

const searchInput = (page: Page) => page.locator('search-bar input.search-input');

// ---------------------------------------------------------------------------------------------
// Navbar and theme
// ---------------------------------------------------------------------------------------------

test.describe('navbar by touch', () => {
  test('tapping the theme toggle switches and remembers the theme', async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await page.goto('index.html');
    const toggle = page.locator('travel-nav .theme-toggle');
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await toggle.tap();
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).not.toBe(before);
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(after);
  });

  test('a guest taps Sign in and is sent to Keycloak', async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await page.goto('index.html');
    const signIn = page.locator('travel-nav .nav-auth-login');
    await expect(signIn).toBeVisible();
    const authorize = page.waitForRequest((r) => r.isNavigationRequest() && /\/protocol\/openid-connect\/auth\?/.test(r.url()));
    await signIn.tap();
    await authorize;
  });

  test('a signed-in user taps their name to reach the profile', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await mockApi(page, { trips: [] });
    await page.goto('dashboard.html');
    await page.locator('travel-nav .nav-auth-user').tap();
    await page.waitForURL(/profile\.html$/);
  });

  test('on a trip, the cities get their own full-width row on a phone', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await mockApi(page);
    await stubMapThirdParty(page);
    const { routeOwnerTrip, japanTrip } = await import('./fixtures/mockTripView');
    await routeOwnerTrip(page, japanTrip());
    await page.goto('trip.html?tripId=11');
    const links = page.locator('travel-nav .top-nav');
    await expect(links.locator('.nav-link')).not.toHaveCount(1);
    const box = (await links.boundingBox())!;
    // Not squeezed beside the account buttons: wide enough to read several city names at once.
    expect(box.width).toBeGreaterThan(300);
  });
});

// ---------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------

test.describe('search by touch', () => {
  test('tap opens it, results are 44px rows, tapping one opens that place', async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await stubMapThirdParty(page);
    await page.goto('index.html#demo');
    await expect(page.locator('#landing-hero')).toBeVisible();
    await searchInput(page).tap();
    await expect(page.locator('search-bar .search-container')).toHaveClass(/expanded/);
    await searchInput(page).fill('teamlab');
    const rows = page.locator('search-bar [role="option"]');
    await expect(rows.first()).toBeVisible();
    const heights = (await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))).filter((h) => h > 0);
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    await rows.first().tap();
    await expect(page.locator('search-bar .search-dropdown.open')).toHaveCount(0);
  });

  test('the clear button is a 44px target and empties the field', async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await page.goto('recover.html');
    await searchInput(page).tap();
    await searchInput(page).fill('kyoto');
    const clear = page.locator('search-bar .clear-btn');
    await expect(clear).toBeVisible();
    const box = (await clear.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await clear.tap();
    await expect(searchInput(page)).toHaveValue('');
  });

  test('on the dashboard it searches the user\'s own trips', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await mockTripsBackend(page);
    await page.goto('dashboard.html');
    await searchInput(page).tap();
    await searchInput(page).fill('Hokkaido');
    await expect(page.locator('search-bar .result-title').first()).toContainText(/Hokkaido/i);
    await expect(page.locator('search-bar .scope-chip')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------
// Trip editor
// ---------------------------------------------------------------------------------------------

test.describe('trip editor by touch', () => {
  test('Plan / Map & preview tabs and the three steps respond to taps', async ({ page }) => {
    await openEditorAt(page, '#route');
    await page.locator('#te-tab-preview').tap();
    await expect(page.locator('#te-preview')).toBeVisible();
    await expect(page.locator('#te-plan')).toBeHidden();
    await expect(page.locator('#map .leaflet-marker-icon').first()).toBeVisible();
    await page.locator('#te-tab-plan').tap();
    await expect(page.locator('#te-plan')).toBeVisible();
    for (const [step, marker] of [['trip', '#metadata-form'], ['share', '#view-trip'], ['route', '#dest-search']] as const) {
      await page.locator(`.te-step[data-step="${step}"]`).tap();
      await expect(page.locator(marker)).toBeVisible();
    }
  });

  test('city search: type, tap a suggestion, the city is added', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await stubMapThirdParty(page);
    const store = await mockTripStore(page, { trips: [{ ...mobileTrip(), destinations: [] }] });
    await page.goto('trip-edit.html?tripId=1#route');
    await expect(page.locator('#dest-search')).toBeVisible();
    await page.locator('#dest-search').tap();
    await page.locator('#dest-search').fill('kyoto');
    const option = page.locator('#dest-search-list .place-option:not(.place-option--free)').first();
    await expect(option).toBeVisible();
    expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await option.tap();
    await expect(page.locator('#destinations-list .te-dest')).toHaveCount(1);
    await expect.poll(() => store.writes('POST').some((c) => c.path.endsWith('/destinations'))).toBe(true);
  });

  test('move buttons reorder a place (the touch-friendly equivalent of dragging)', async ({ page }) => {
    await openEditorAt(page, '#city/11');
    const names = page.locator('.te-act .te-act-name');
    await expect(names).toHaveCount(3);
    const first = await names.nth(0).inputValue();
    await page.locator('.te-act').nth(0).locator('[data-role="down"]').tap();
    await expect(names.nth(1)).toHaveValue(first);
  });

  test('drag the grip with a finger to reorder places', async ({ page, browserName }) => {
    test.fixme(browserName !== 'chromium', 'raw touch events need the Chromium DevTools protocol');
    await page.setViewportSize({ width: 390, height: 1400 }); // all three rows on screen: raw touches cannot scroll
    await openEditorAt(page, '#city/11');
    const names = page.locator('.te-act .te-act-name');
    const first = await names.nth(0).inputValue();
    const grip = (await page.locator('.te-act').nth(0).locator('[data-role="grip"]').boundingBox())!;
    const target = (await page.locator('.te-act').nth(2).boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const x = grip.x + grip.width / 2;
    const y0 = grip.y + grip.height / 2;
    const touch = (type: string, y: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await touch('touchStart', y0);
    for (let i = 1; i <= 8; i++) await touch('touchMove', y0 + ((target.y + target.height - 4 - y0) * i) / 8);
    await touch('touchEnd', 0);
    await expect(names.nth(2)).toHaveValue(first);
  });

  test('delete shows the undo snackbar fully on screen; tapping Undo restores the place', async ({ page }) => {
    await openEditorAt(page, '#city/11');
    await page.locator('.te-act').nth(1).locator('[data-role="delete"]').tap();
    const bar = page.locator('#te-snackbar');
    await expect(bar).toBeVisible();
    const box = (await bar.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    const undo = (await page.locator('#undo-btn').boundingBox())!;
    expect(undo.height).toBeGreaterThanOrEqual(44);
    await page.locator('#undo-btn').tap();
    await expect(page.locator('.te-act')).toHaveCount(3);
  });

  test('drop a pin: tapping the button moves to the map, tapping the map adds the place there', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await stubMapThirdParty(page);
    const store = await mockTripStore(page, { trips: [mobileTrip()] });
    await page.goto('trip-edit.html?tripId=1#city/11');
    await expect(page.locator('#pick-pin')).toBeVisible();
    await page.locator('#pick-pin').tap();
    await expect(page.locator('#te-pick-banner')).toBeVisible();
    await expect(page.locator('#map')).toBeVisible();
    await page.locator('#map').tap({ position: { x: 150, y: 150 } });
    await expect.poll(() => store.writes('POST').filter((c) => /activities$/.test(c.path)).length).toBe(1);
    const body = store.writes('POST').find((c) => /activities$/.test(c.path))!.body as { lat: number; lng: number };
    expect(typeof body.lat).toBe('number');
    expect(typeof body.lng).toBe('number');
  });

  test('row actions are visible without hovering (there is no hover on a phone)', async ({ page }) => {
    await openEditorAt(page, '#city/11');
    const hover = await page.evaluate(() => matchMedia('(hover: hover)').matches);
    expect(hover).toBe(false);
    for (const role of ['grip', 'up', 'down', 'delete', 'toggle']) {
      const el = page.locator('.te-act').nth(1).locator(`[data-role="${role}"]`);
      await expect(el).toBeVisible();
      expect(await el.evaluate((e) => getComputedStyle(e).opacity)).not.toBe('0');
    }
  });

  test('tapping a button does not leave a keyboard focus ring behind', async ({ page }) => {
    await openEditorAt(page, '#route');
    const tab = page.locator('#te-tab-preview');
    await tab.tap();
    expect(await tab.evaluate((e) => e.matches(':focus-visible'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Keyboard overlap (a short viewport = the on-screen keyboard is up)
// ---------------------------------------------------------------------------------------------

test.describe('virtual keyboard', () => {
  test('a focused field stays visible and is not covered by fixed UI when the viewport shrinks', async ({ page }) => {
    await openEditorAt(page, '#city/11');
    // The undo snackbar is fixed to the bottom: the worst possible thing to leave under a keyboard.
    await page.locator('.te-act').nth(2).locator('[data-role="delete"]').tap();
    await expect(page.locator('#te-snackbar')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 330 });
    const field = page.locator('#act-search');
    await field.tap();
    await field.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    const covered = await field.evaluate((e) => {
      const r = e.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { inView: r.top >= 0 && r.bottom <= window.innerHeight, hitsField: hit === e || e.contains(hit) };
    });
    expect(covered).toEqual({ inView: true, hitsField: true });
  });
});

// ---------------------------------------------------------------------------------------------
// Map gestures vs page scroll
// ---------------------------------------------------------------------------------------------

test.describe('map gestures', () => {
  test('one finger is left to the page (touch-action), two fingers belong to the map', async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await stubMapThirdParty(page);
    await page.goto('tokyo.html');
    await expect(page.locator('#map .leaflet-marker-icon').first()).toBeVisible();
    // Headless Chromium does not turn synthesised swipes into scrolls, so assert the contract the
    // browser acts on: the map must not claim vertical panning (touch-action: none would), and
    // Leaflet's one-finger drag handler must be off (no grab cursor / touch-drag class).
    const state = await page.locator('#map').evaluate((e) => ({
      touchAction: getComputedStyle(e).touchAction,
      drag: e.classList.contains('leaflet-touch-drag'),
      pinch: e.classList.contains('leaflet-touch-zoom'),
    }));
    expect(state.touchAction).toContain('pan-y');
    expect(state.drag).toBe(false);
    expect(state.pinch).toBe(true);
  });

  test('pinching zooms the map', async ({ page, browserName }) => {
    test.fixme(browserName !== 'chromium', 'synthesised touch gestures need the Chromium DevTools protocol');
    await mockKeycloakLoggedOut(page);
    await stubMapThirdParty(page);
    await page.goto('tokyo.html');
    const map = page.locator('#map');
    await expect(map.locator('.leaflet-marker-icon').first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.querySelector('#map')!.getBoundingClientRect().top + window.scrollY - 20));
    const zoom = () => page.evaluate(() => Math.max(0, ...Array.from(document.querySelectorAll<HTMLImageElement>('.leaflet-tile-loaded')).map((i) => Number(/\/(\d+)\/\d+\/\d+\.png/.exec(i.src)?.[1] ?? 0))));
    await expect.poll(zoom).toBeGreaterThan(0);
    const before = await zoom();
    const box = (await map.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.synthesizePinchGesture', {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
      scaleFactor: 2.5,
      gestureSourceType: 'touch',
    });
    await expect.poll(zoom).toBeGreaterThan(before);
  });

  test('a one-finger drag shows the "two fingers" hint', async ({ page, browserName }) => {
    test.fixme(browserName !== 'chromium', 'raw touch events need the Chromium DevTools protocol');
    await mockKeycloakLoggedOut(page);
    await stubMapThirdParty(page);
    await page.goto('tokyo.html');
    const map = page.locator('#map');
    await expect(map.locator('.leaflet-marker-icon').first()).toBeVisible();
    await map.scrollIntoViewIfNeeded();
    const box = (await map.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const x = box.x + box.width / 2;
    const y = Math.min(box.y + box.height / 2, page.viewportSize()!.height - 40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let i = 1; i <= 4; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 6, id: 1 }] });
    await expect(map.locator('.map-gesture-hint')).toHaveText('Use two fingers to move the map');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  });
});
