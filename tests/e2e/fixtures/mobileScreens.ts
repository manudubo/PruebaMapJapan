import { expect, type Page } from '@playwright/test';
import { mockApi } from './mockApi';
import { mockKeycloakLoggedIn, mockKeycloakLoggedOut } from './mockKeycloak';
import { stubMapThirdParty } from './mockThirdParty';
import { mockAccountCredentials, mockAuthFlows, WEBAUTHN_SUPPORTED } from './mockAuthFlows';
import { mockTripStore, emptyTrip } from './mockTripStore';
import { japanTrip, longNamesTrip, routeOwnerTrip } from './mockTripView';

/**
 * Every user-facing screen, reachable hermetically (Keycloak, API, tiles and external hosts are
 * mocked), so the mobile specs can sweep them all with the same checks and screenshots.
 */

export interface Screen {
  /** Stable key, also the screenshot file name. */
  name: string;
  /** Group used by the matrix document. */
  area: 'public' | 'account' | 'editor';
  /** Navigate to the screen and wait for its main content. */
  open(page: Page): Promise<void>;
}

/** Third-party hosts are not part of what we test, and font CSS would make `load` flaky. */
async function blockExternal(page: Page): Promise<void> {
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)(?!tile\.openstreetmap\.org)/, (r) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(r.request().url())) return r.abort();
    return r.fallback();
  });
}

export const CITY_PAGES = ['tokyo', 'nagoya', 'takayama', 'kyoto', 'osaka', 'naoshima', 'hakone', 'tokyo2'] as const;

/** A saved trip with two days of activities, hotel, and an Edit link target. */
export const mobileTrip = () => ({
  ...emptyTrip(),
  name: 'Japan 2026',
  destinations: [
    {
      id: 11, trip_id: 1, city_name: 'Tokyo', country: 'Japan', start_date: '2026-02-22', end_date: '2026-02-26',
      lat: 35.6768, lng: 139.7638, zoom_level: 12, order_index: 0,
      hotel: { id: 21, name: 'Hotel Gracery Shinjuku', url: null, lat: 35.6954, lng: 139.7017, check_in_date: '2026-02-22', check_out_date: '2026-02-26' },
      days: [
        {
          id: 31, date: '2026-02-23', label: 'Day 2', color_hex: '#ff3b30', order_index: 0,
          activities: [
            { id: 41, name: 'Senso-ji', lat: 35.7148, lng: 139.7967, notes: 'Go early', time: '09:00', is_optional: false, is_generic: false, maps_url: null, order_index: 0 },
            { id: 42, name: 'teamLab Planets with a rather long name that wraps', lat: 35.6491, lng: 139.7898, notes: null, time: null, is_optional: true, is_generic: false, maps_url: null, order_index: 1 },
            { id: 43, name: 'Ramen somewhere', lat: null, lng: null, notes: null, time: null, is_optional: false, is_generic: true, maps_url: null, order_index: 2 },
          ],
        },
      ],
    },
    {
      id: 12, trip_id: 1, city_name: 'Kyoto', country: 'Japan', start_date: '2026-02-26', end_date: '2026-03-02',
      lat: 35.0116, lng: 135.7681, zoom_level: 12, order_index: 1, hotel: null, days: [],
    },
  ],
});

async function openEditorAt(page: Page, hash: string, trip: unknown = mobileTrip()): Promise<void> {
  await blockExternal(page);
  await mockKeycloakLoggedIn(page);
  await stubMapThirdParty(page);
  await mockTripStore(page, { trips: [trip] });
  await page.goto(`trip-edit.html?tripId=1${hash}`);
  await expect(page.locator('#te-workspace')).toBeVisible();
  await expect(page.locator('#te-view')).not.toBeEmpty();
}

export const SCREENS: Screen[] = [
  {
    name: 'landing',
    area: 'public',
    async open(page) {
      await blockExternal(page);
      await mockKeycloakLoggedOut(page);
      await stubMapThirdParty(page);
      await page.goto('index.html');
      await expect(page.locator('#landing-hero h1')).toBeVisible();
    },
  },
  {
    name: 'landing-demo',
    area: 'public',
    async open(page) {
      await blockExternal(page);
      await mockKeycloakLoggedOut(page);
      await stubMapThirdParty(page);
      await page.goto('index.html#demo');
      await expect(page.locator('#landing-hero')).toBeVisible();
      await page.locator('#overview-map-slot, #map').first().scrollIntoViewIfNeeded();
    },
  },
  ...CITY_PAGES.map<Screen>((city) => ({
    name: `city-${city}`,
    area: 'public',
    async open(page) {
      await blockExternal(page);
      await mockKeycloakLoggedOut(page);
      await stubMapThirdParty(page);
      await page.goto(`${city}.html`);
      await expect(page.locator('#map .leaflet-marker-icon').first()).toBeVisible();
    },
  })),
  {
    name: 'recover',
    area: 'public',
    async open(page) {
      await blockExternal(page);
      await mockKeycloakLoggedOut(page);
      await mockApi(page);
      await mockAuthFlows(page);
      await page.goto('recover.html');
      await expect(page.locator('main h1, #main-content h1').first()).toBeVisible();
    },
  },
  {
    name: 'dashboard',
    area: 'account',
    async open(page) {
      await blockExternal(page);
      await mockKeycloakLoggedIn(page);
      await mockApi(page, { trips: [japanTrip(), longNamesTrip] });
      await stubMapThirdParty(page);
      await page.goto('dashboard.html');
      await expect(page.locator('#trips-grid .trip-card:not(.trip-card--skeleton)').first()).toBeVisible();
    },
  },
  {
    name: 'dashboard-empty',
    area: 'account',
    async open(page) {
      await blockExternal(page);
      await mockKeycloakLoggedIn(page);
      await mockApi(page, { trips: [] });
      await page.goto('dashboard.html');
      await expect(page.locator('#trips-grid')).toBeVisible();
      await expect(page.locator('#trips-grid .trip-card--skeleton')).toHaveCount(0);
    },
  },
  {
    name: 'trip-overview',
    area: 'account',
    async open(page) {
      await blockExternal(page);
      await mockKeycloakLoggedIn(page);
      await mockApi(page);
      await stubMapThirdParty(page);
      await routeOwnerTrip(page, japanTrip());
      await page.goto('trip.html?tripId=11');
      await expect(page.locator('#overview-cities .city-card').first()).toBeVisible();
      await expect(page.locator('#map .leaflet-marker-icon').first()).toBeVisible();
    },
  },
  {
    name: 'trip-city',
    area: 'account',
    async open(page) {
      await blockExternal(page);
      await mockKeycloakLoggedIn(page);
      await mockApi(page);
      await stubMapThirdParty(page);
      await routeOwnerTrip(page, japanTrip());
      await page.goto('trip.html?tripId=11&destIndex=0');
      await expect(page.locator('#view-city')).toBeVisible();
      await expect(page.locator('#map .leaflet-marker-icon').first()).toBeVisible();
    },
  },
  {
    name: 'profile',
    area: 'account',
    async open(page) {
      await blockExternal(page);
      await page.addInitScript(WEBAUTHN_SUPPORTED);
      await mockKeycloakLoggedIn(page);
      await mockAccountCredentials(page, { passkeys: 2, passwords: 1 });
      await mockApi(page, { trips: [] });
      await page.goto('profile.html');
      await expect(page.locator('#passkey-list li').first()).toBeVisible();
    },
  },
  {
    name: 'verify-email',
    area: 'account',
    async open(page) {
      await blockExternal(page);
      const verification = { verified: false };
      await page.addInitScript(WEBAUTHN_SUPPORTED);
      await mockKeycloakLoggedIn(page);
      await mockAccountCredentials(page, { passkeys: 0, passwords: 1 });
      await mockApi(page, { trips: [], verification });
      await mockAuthFlows(page, { code: '123456', verification });
      await page.goto('dashboard.html');
      await expect(page.locator('.code-input-digit').first()).toBeVisible();
    },
  },
  {
    name: 'passkey-dialog',
    area: 'account',
    async open(page) {
      await blockExternal(page);
      await page.addInitScript(WEBAUTHN_SUPPORTED);
      await mockKeycloakLoggedIn(page);
      await mockAccountCredentials(page, { passkeys: 0, passwords: 1 });
      await mockApi(page, { trips: [], me: { onboarding: { is_new: true } } });
      await mockAuthFlows(page);
      await page.goto('dashboard.html');
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  {
    name: 'editor-trip',
    area: 'editor',
    async open(page) {
      await openEditorAt(page, '#trip');
      await expect(page.locator('#metadata-form')).toBeVisible();
    },
  },
  {
    name: 'editor-route',
    area: 'editor',
    async open(page) {
      await openEditorAt(page, '#route');
      await expect(page.locator('#dest-search')).toBeVisible();
    },
  },
  {
    name: 'editor-city',
    area: 'editor',
    async open(page) {
      await openEditorAt(page, '#city/11');
    },
  },
  {
    name: 'editor-share',
    area: 'editor',
    async open(page) {
      await openEditorAt(page, '#share');
    },
  },
  {
    name: 'editor-new',
    area: 'editor',
    async open(page) {
      await blockExternal(page);
      await mockKeycloakLoggedIn(page);
      await stubMapThirdParty(page);
      await mockTripStore(page, { trips: [] });
      await page.goto('trip-edit.html?new=1');
      await expect(page.locator('#metadata-form')).toBeVisible();
    },
  },
];

export { openEditorAt };
