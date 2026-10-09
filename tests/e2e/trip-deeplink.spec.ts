import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './fixtures/mockApi';
import { mockKeycloakLoggedIn } from './fixtures/mockKeycloak';
import { stubMapThirdParty } from './fixtures/mockThirdParty';
import { trip, city, day, routeOwnerTrip, routePublicTrip } from './fixtures/mockTripView';

/**
 * Search deep links: trip.html?tripId=..&destIndex=N&day=YYYY-MM-DD&activity=<name>[&activityId=<id>]
 * open the matched city, select the day and focus the activity (map popup + highlighted, focused
 * legend row). Unknown values fall back without errors, and the URL is never stripped.
 * Hermetic: Keycloak, API, tiles and Open-Meteo are mocked.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const SPECIAL = 'Café “Ü” & Ramen <b>1</b> #2 100% 浅草寺 🍜';
const LONG = `Very long activity name ${'x'.repeat(280)} end`;

// Dates far in the future: the weather card has nothing to do with these specs.
const D1 = '2031-05-01';
const D2 = '2031-05-02';

const tokyoDays = [
  day(D1, 'Day 1', '#ff3b30', [
    { name: 'Ramen', lat: 35.7, lng: 139.7 },
    { name: SPECIAL, lat: 35.71, lng: 139.72 },
    { name: 'Walk without a pin', lat: null, lng: null, notes: 'Wander' },
    { name: LONG, lat: 35.72, lng: 139.74 },
  ]),
  day(D2, 'Day 2', '#ff9500', [
    { name: 'Ramen', lat: 35.65, lng: 139.8 },
    { name: 'Museum', lat: 35.66, lng: 139.81 },
  ]),
];
const kyotoDays = [day(D1, 'Temple day', '#34c759', [{ name: 'Fushimi Inari', lat: 34.97, lng: 135.77 }])];

const deepTrip = trip({ id: 31, name: 'Deep links' }, [
  city({ name: 'Tokyo', lat: 35.68, lng: 139.65, start: D1, end: D2, days: tokyoDays }),
  city({ name: 'Kyoto', lat: 35.01, lng: 135.76, start: D1, end: D1, days: kyotoDays }),
]);

type Seed = { id: string | number; name: string };
const acts = (di: number, dayIndex: number): Seed[] =>
  (deepTrip.destinations[di]!.days[dayIndex]!.activities as unknown as Seed[]);
const idOf = (di: number, dayIndex: number, name: string, nth = 0): string =>
  String(acts(di, dayIndex).filter((a) => a.name === name)[nth]!.id);

function qs(params: Record<string, string>): string {
  return `trip.html?${new URLSearchParams(params).toString()}`;
}

async function open(page: Page, url: string, options: Parameters<typeof routeOwnerTrip>[2] = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockKeycloakLoggedIn(page);
  await mockApi(page);
  await stubMapThirdParty(page);
  await page.route('https://api.open-meteo.com/**', (route) => route.abort());
  await routeOwnerTrip(page, deepTrip, options);
  await page.goto(url);
  return errors;
}

const popupTitle = (page: Page) => page.locator('#map .leaflet-popup h4');
const focusedRow = (page: Page) => page.locator('#legend-grid .legend-item.is-focused');
const activeDay = (page: Page) => page.locator('#day-selector .day-btn.active');
const visibleGroups = (page: Page) => page.locator('#legend-grid .day-group:not([hidden])');
const searchParams = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams);

async function expectFocused(page: Page, name: string, dayKey: string) {
  await expect(popupTitle(page)).toHaveText(name);
  await expect(activeDay(page)).toHaveAttribute('data-day', dayKey);
  await expect(visibleGroups(page)).toHaveCount(1);
  await expect(focusedRow(page)).toHaveCount(1);
  await expect(focusedRow(page)).toContainText(name);
  await expect(focusedRow(page)).toBeFocused();
}

test.describe('deep link to an activity', () => {
  test('destination, day and activity: day selected, popup open, row highlighted and focused, URL kept', async ({ page }) => {
    const errors = await open(page, qs({
      tripId: '31', destIndex: '0', day: D2, activity: 'Museum', activityId: idOf(0, 1, 'Museum'),
    }));
    await expect(page.locator('#trip-title')).toHaveText('Tokyo');
    await expectFocused(page, 'Museum', D2);
    expect(searchParams(page)).toEqual({
      tripId: '31', destIndex: '0', day: D2, activity: 'Museum', activityId: idOf(0, 1, 'Museum'),
    });
    expect(errors).toEqual([]);
  });

  test('the legend row is announced to assistive tech and the map keeps its name', async ({ page }) => {
    await open(page, qs({ tripId: '31', destIndex: '0', day: D2, activity: 'Museum' }));
    await expect(popupTitle(page)).toHaveText('Museum');
    await expect(page.locator('div[role="status"].sr-only', { hasText: 'Museum, Day 2. Opened on the map.' })).toHaveCount(1);
    await expect(page.locator('#map')).toHaveAttribute('aria-label', 'Map of Tokyo');
  });

  test('duplicate names: the day tells them apart', async ({ page }) => {
    await open(page, qs({ tripId: '31', destIndex: '0', day: D2, activity: 'Ramen' }));
    await expect(page.locator('#map .leaflet-popup .day-label')).toContainText('Day 2');
    await expectFocused(page, 'Ramen', D2);
    // ...and it resolved to the second one, so the id is added to the address
    expect(searchParams(page)['activityId']).toBe(idOf(0, 1, 'Ramen'));
  });

  test('the stable id wins over a name that exists on another day', async ({ page }) => {
    await open(page, qs({ tripId: '31', destIndex: '0', day: D2, activity: 'Ramen', activityId: idOf(0, 0, 'Ramen') }));
    await expectFocused(page, 'Ramen', D1);
    expect(searchParams(page)['day']).toBe(D1);
  });

  test('special characters, unicode and markup in the name', async ({ page }) => {
    const errors = await open(page, qs({ tripId: '31', destIndex: '0', day: D1, activity: SPECIAL }));
    await expectFocused(page, SPECIAL, D1);
    await expect(page.locator('#map .leaflet-popup b')).toHaveCount(0); // shown as text, not parsed
    expect(searchParams(page)['activity']).toBe(SPECIAL);
    expect(errors).toEqual([]);
  });

  test('a very long name', async ({ page }) => {
    await open(page, qs({ tripId: '31', destIndex: '0', day: D1, activity: LONG }));
    await expectFocused(page, LONG, D1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('the name is matched ignoring case and extra spaces', async ({ page }) => {
    await open(page, qs({ tripId: '31', destIndex: '0', day: D2, activity: '  mUSEUM ' }));
    await expectFocused(page, 'Museum', D2);
    expect(searchParams(page)['activity']).toBe('Museum');
  });

  test('an activity without coordinates: day and row selected, a short note, the map does not move', async ({ page }) => {
    await open(page, qs({ tripId: '31', destIndex: '0', day: D1, activity: 'Walk without a pin' }));
    await expect(activeDay(page)).toHaveAttribute('data-day', D1);
    await expect(focusedRow(page)).toContainText('Walk without a pin');
    await expect(focusedRow(page)).toBeFocused();
    await expect(page.locator('#city-map-note')).toHaveText('"Walk without a pin" has no location on the map yet, so the map stays where it is.');
    await expect(page.locator('#map .leaflet-popup')).toHaveCount(0);

    // Picking another day clears the note.
    await page.locator('#day-selector .day-btn[data-day="' + D2 + '"]').click();
    await expect(page.locator('#city-map-note')).toBeHidden();
  });

  test('a link with the day only selects the day', async ({ page }) => {
    await open(page, qs({ tripId: '31', destIndex: '0', day: D2 }));
    await expect(activeDay(page)).toHaveAttribute('data-day', D2);
    await expect(visibleGroups(page)).toHaveCount(1);
    await expect(focusedRow(page)).toHaveCount(0);
    await expect(page.locator('#map .leaflet-popup')).toHaveCount(0);
  });

  test('a link with the id only opens the right city, day and activity', async ({ page }) => {
    await open(page, qs({ tripId: '31', activityId: idOf(1, 0, 'Fushimi Inari') }));
    await expect(page.locator('#trip-title')).toHaveText('Kyoto');
    await expectFocused(page, 'Fushimi Inari', D1);
    expect(searchParams(page)['destIndex']).toBe('1');
  });

  test('a shared (slug) link works too and keeps the slug', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockApi(page);
    await stubMapThirdParty(page);
    await page.route('https://api.open-meteo.com/**', (route) => route.abort());
    await routePublicTrip(page, { ...deepTrip, is_public: true, public_slug: 'deep-1' });
    await page.goto(qs({ slug: 'deep-1', destIndex: '0', day: D2, activity: 'Museum' }));
    await expectFocused(page, 'Museum', D2);
    expect(searchParams(page)['slug']).toBe('deep-1');
    expect(errors).toEqual([]);
  });
});

test.describe('deep link edge cases fall back without errors', () => {
  test('unknown activity on a known day: the day is selected, nothing is focused', async ({ page }) => {
    const errors = await open(page, qs({ tripId: '31', destIndex: '0', day: D2, activity: 'Does not exist' }));
    await expect(activeDay(page)).toHaveAttribute('data-day', D2);
    await expect(focusedRow(page)).toHaveCount(0);
    await expect(page.locator('#map .leaflet-popup')).toHaveCount(0);
    await expect(page.locator('#city-map-note')).toBeHidden();
    expect(searchParams(page)['activity']).toBeUndefined(); // the address says what is shown
    expect(errors).toEqual([]);
  });

  test('unknown day: the activity is found on the day that has it', async ({ page }) => {
    await open(page, qs({ tripId: '31', destIndex: '0', day: '1999-01-01', activity: 'Museum' }));
    await expectFocused(page, 'Museum', D2);
  });

  test('unknown day and activity: the city opens as usual', async ({ page }) => {
    const errors = await open(page, qs({ tripId: '31', destIndex: '0', day: 'nope', activity: 'nope', activityId: 'nope' }));
    await expect(page.locator('#trip-title')).toHaveText('Tokyo');
    await expect(activeDay(page)).toHaveCount(0);
    await expect(focusedRow(page)).toHaveCount(0);
    await expect(page.locator('#legend-grid .day-group')).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test('unknown destIndex: the overview opens, no error, parameters untouched', async ({ page }) => {
    const errors = await open(page, qs({ tripId: '31', destIndex: '9', day: D1, activity: 'Ramen' }));
    await expect(page.locator('#overview-cities .city-card')).toHaveCount(2);
    await expect(page.locator('#view-city')).toBeHidden();
    expect(searchParams(page)).toEqual({ tripId: '31', destIndex: '9', day: D1, activity: 'Ramen' });
    expect(errors).toEqual([]);
  });

  test('empty parameters are ignored', async ({ page }) => {
    const errors = await open(page, qs({ tripId: '31', destIndex: '0', day: '', activity: '', activityId: '' }));
    await expect(page.locator('#trip-title')).toHaveText('Tokyo');
    await expect(activeDay(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a slow trip: the focus is applied once it arrives', async ({ page }) => {
    await open(page, qs({ tripId: '31', destIndex: '0', day: D2, activity: 'Museum' }), { delayMs: 1200 });
    await expect(page.locator('#trip-skeleton')).toBeVisible();
    await expectFocused(page, 'Museum', D2);
  });

  test('back and forward keep working: the focus returns with the entry that had it', async ({ page }) => {
    await open(page, qs({ tripId: '31', destIndex: '0', day: D2, activity: 'Museum' }));
    await expectFocused(page, 'Museum', D2);

    await page.locator('#trip-back').click(); // pushState to the overview
    await expect(page.locator('#overview-cities .city-card')).toHaveCount(2);
    expect(searchParams(page)).toEqual({ tripId: '31' }); // focus belongs to the city it was written for

    await page.goBack();
    await expect(page.locator('#trip-title')).toHaveText('Tokyo');
    await expectFocused(page, 'Museum', D2);
    expect(searchParams(page)['tripId']).toBe('31');

    await page.goForward();
    await expect(page.locator('#overview-cities .city-card')).toHaveCount(2);
  });

  test('switching city drops the old focus but keeps the trip', async ({ page }) => {
    await open(page, qs({ tripId: '31', destIndex: '0', day: D2, activity: 'Museum' }));
    await expectFocused(page, 'Museum', D2);
    await page.locator('#dest-tabs a', { hasText: 'Kyoto' }).click();
    await expect(page.locator('#trip-title')).toHaveText('Kyoto');
    expect(searchParams(page)).toEqual({ tripId: '31', destIndex: '1' });
    await expect(focusedRow(page)).toHaveCount(0);
  });
});
