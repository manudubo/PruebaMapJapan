import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mockTripStore, type TripStore } from './fixtures/mockTripStore';
import { saved } from './fixtures/editorHelpers';
import { mockKeycloakLoggedIn, mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import { stubMapThirdParty } from './fixtures/mockThirdParty';
import {
  GeocoderMock, TRIP_NAME, addDestinationInEditor, buildCityInEditor, demoCities, seedCityInStore, tripEnd, tripStart,
  type DemoCity,
} from './fixtures/demoTrip';
import {
  applyGaps, citySnapshot, diffDeep, normalizeCityPair, overviewSnapshot, pointOf, userTimes,
  type CitySnapshot, type ExpectedGap, type OverviewSnapshot,
} from './fixtures/tripSnapshot';

/**
 * DEMO PARITY — the acceptance test of the whole product.
 *
 * Question it answers: "if I build the Japan 2026 trip myself in the editor, do I get the same
 * product the demo is?"  The demo (index.html#demo + the eight city pages) is read as the oracle;
 * the same itinerary is then rebuilt as a user would, saved through the (in-memory) API, opened in
 * trip.html and compared with the oracle, field by field (fixtures/tripSnapshot.ts).
 *
 * How the trip is built (about 20 s of the run):
 *  - trip name + dates, then ALL EIGHT destinations by place search: through the UI.
 *  - Kyoto (6 days, 24 places, a general area "Free day", hotel), Osaka (alternatives A/B where B is
 *    also a general area, hotel) and Takayama (alternatives A/B/C then 1/2/3, zoom 10, hotel):
 *    every date, zoom, place (search -> name, notes, alternative / general-area flags, a few
 *    times) and hotel is entered through the real editor UI.
 *  - Tokyo, Nagoya, Naoshima, Hakone, Tokyo (return): their days/places/hotel are written straight
 *    into the stateful API mock in the API's row shape (same data, no clicks) so that the overview,
 *    the route and the card list are complete. Clicking 90 more places adds time, not coverage.
 *
 *   npm run build --workspace=frontend (with VITE_API_URL + VITE_KEYCLOAK_URL, as CI does)
 *   npm run preview --workspace=frontend
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test demo-parity --project=chromium
 */

test.use({ storageState: { cookies: [], origins: [] } });

/** Cities entered through the editor UI (the rest is seeded through the store). */
const UI_CITIES = new Set(['takayama', 'kyoto', 'osaka']);

/** Clock times the user types in the editor (the demo has none): a place name -> HH:MM. */
const USER_TIMES: Record<string, string> = { 'Fushimi Inari Taisha': '18:30', 'Universal Studios Japan': '09:00' };

/**
 * KNOWN GAPS between what the editor can express and what the demo shows. Every entry needs a
 * product / backend decision, so the test asserts the supported subset and fails if a gap
 * silently disappears (then delete the entry) or a new difference shows up.
 */
const EXPECTED_GAPS: ExpectedGap[] = [
  {
    id: 'takayama-option-labels',
    reason:
      'The demo labels the alternatives of Sat 7 "1, 2, 3" and those of Fri 6 "A, B, C". The API stores only the ' +
      'is_optional flag, so the view derives the label (A, B, C... per day, tripAdapter.optionLabel). Custom labels need ' +
      'a new column (activities.option_label) in the backend and a field in the editor: a product decision.',
    match: /^(days\[3\]\.items\[\d\]\.marker\.text|markers\[\d+\]\.text|markers\[\d+\]\.popup\.badge): demo="(Option )?[123]" user="(Option )?[ABC]"$/,
  },
];

const world: {
  context?: BrowserContext;
  demoContext?: BrowserContext;
  demo?: { page: Page; overview: OverviewSnapshot; cities: Record<string, CitySnapshot> };
  user?: { page: Page; store: TripStore; tripId: number };
} = {};

const cities = demoCities();
const geo = new GeocoderMock();

async function openDemoCity(page: Page, key: string): Promise<CitySnapshot> {
  await page.goto(`${key}.html`);
  await expect(page.locator('#legend-grid .day-group').first()).toBeVisible();
  await expect(page.locator('#map .hotel-marker')).toHaveCount(1);
  return citySnapshot(page);
}

async function openUserCity(page: Page, tripId: number, index: number): Promise<CitySnapshot> {
  await page.goto(`trip.html?tripId=${tripId}&destIndex=${index}`);
  await expect(page.locator('#legend-grid .day-group').first()).toBeVisible();
  await expect(page.locator('#map .hotel-marker')).toHaveCount(1);
  return citySnapshot(page);
}

async function readDemo(context: BrowserContext): Promise<NonNullable<typeof world.demo>> {
  const page = await context.newPage();
  await mockKeycloakLoggedOut(page);
  await stubMapThirdParty(page);
  await page.goto('');
  await page.locator('#map').scrollIntoViewIfNeeded();
  await expect(page.locator('#map .numbered-marker')).toHaveCount(8);
  const overview = await overviewSnapshot(page);
  const snaps: Record<string, CitySnapshot> = {};
  for (const c of cities) snaps[c.key] = await openDemoCity(page, c.key);
  return { page, overview, cities: snaps };
}

async function buildUserTrip(context: BrowserContext, demoOverview: OverviewSnapshot): Promise<NonNullable<typeof world.user>> {
  const page = await context.newPage();
  await mockKeycloakLoggedIn(page);
  await stubMapThirdParty(page);
  const store = await mockTripStore(page, {});
  await geo.install(page);

  await page.goto('trip-edit.html?new=1');
  await expect(page.locator('#metadata-form')).toBeVisible();
  await page.locator('#trip-name').fill(TRIP_NAME);
  await page.locator('#trip-start-date').fill(tripStart(cities));
  await page.locator('#trip-end-date').fill(tripEnd(cities));
  await page.locator('#metadata-save-btn').click();
  await expect(page).toHaveURL(/trip-edit\.html\?tripId=\d+#route/);

  // all eight stops by place search; the pin is the one the demo's overview shows
  for (const [i, c] of cities.entries()) {
    const m = demoOverview.markers[i]!;
    const query = c.key === 'tokyo2' ? 'Tokyo (return)' : c.data.name;
    await addDestinationInEditor(page, geo, query, [m.lat, m.lng], `${c.data.name}, Japan`);
    await expect(page.locator('#destinations-list > li')).toHaveCount(i + 1);
  }

  let nextId = 50_000;
  for (const [i, c] of cities.entries()) {
    if (UI_CITIES.has(c.key)) await buildCityInEditor(page, geo, c, i, { times: USER_TIMES });
    else nextId = seedCityInStore(store, i, c, nextId);
  }
  await saved(page);
  return { page, store, tripId: store.trips[0]!.id };
}

test.describe.serial('Demo parity: the demo itinerary, rebuilt in the editor, is shown like the demo', () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(240_000);
    // two contexts: the demo is read signed out, the trip is built signed in (no shared storage)
    const options = { baseURL: test.info().project.use.baseURL, viewport: { width: 1280, height: 900 } };
    world.demoContext = await browser.newContext(options);
    world.context = await browser.newContext(options);
    world.demo = await readDemo(world.demoContext);
    world.user = await buildUserTrip(world.context, world.demo.overview);
  });

  test.afterAll(async () => {
    await world.context?.close();
    await world.demoContext?.close();
  });

  test('the editor saved what the demo describes (route, dates, places, flags)', async () => {
    const { store } = world.user!;
    const trip = store.trips[0]! as unknown as { start_date: string; end_date: string; destinations: Array<Record<string, unknown> & { days: Array<{ date: string; activities: unknown[] }> }> };
    expect(trip.start_date).toBe(tripStart(cities));
    expect(trip.end_date).toBe(tripEnd(cities));
    expect(trip.destinations.map((d) => d['city_name'])).toEqual(cities.map((c) => c.data.name));
    expect(trip.destinations.map((d) => d['start_date'])).toEqual(cities.map((c) => c.start));
    expect(trip.destinations.map((d) => d['end_date'])).toEqual(cities.map((c) => c.end));
    expect(trip.destinations.map((d) => d['zoom_level'])).toEqual(cities.map((c) => c.data.zoom));
    cities.forEach((c, i) => {
      const days = trip.destinations[i]!.days.slice().sort((a, b) => a.date.localeCompare(b.date));
      expect(days.map((d) => d.date), c.key).toEqual(Object.keys(c.data.days));
      expect(days.map((d) => d.activities.length), c.key).toEqual(Object.values(c.data.days).map((d) => d.activities.length));
    });
  });

  test('overview: the same stops, dashed route, markers and city cards', async () => {
    const { page, tripId } = world.user!;
    await page.goto(`trip.html?tripId=${tripId}`);
    await expect(page.locator('#overview-cities .city-card')).toHaveCount(8);
    await expect(page.locator('#map .numbered-marker')).toHaveCount(8);
    const user = await overviewSnapshot(page);

    // The user's overview frames the stops ('fit'); the demo uses a fixed Japan view. The view is a
    // property of the page, not of the trip, so it is left out of the comparison.
    const demo = world.demo!.overview;
    const strip = (o: OverviewSnapshot): Omit<OverviewSnapshot, 'view'> => ({ markers: o.markers, route: o.route, cards: o.cards });
    const result = applyGaps(diffDeep(strip(demo), strip(user)), EXPECTED_GAPS.filter((g) => g.id.startsWith('overview')));
    expect(result.unexpected, `overview differs from the demo:\n${result.unexpected.join('\n')}`).toEqual([]);
    expect(demo.route.count).toBe(1);
    expect(user.route.points).toHaveLength(8);
  });

  for (const [index, c] of cities.entries()) {
    test(`city ${index + 1}/8 ${c.data.name} (${c.key}${UI_CITIES.has(c.key) ? ', built in the UI' : ', seeded'}): day chips, markers, legend, hotel, links`, async () => {
      const { page, tripId } = world.user!;
      const demoSnap = world.demo!.cities[c.key]!;
      const userSnap = await openUserCity(page, tripId, index);
      const [d, u] = normalizeCityPair(demoSnap, userSnap);

      const mine = EXPECTED_GAPS.filter((g) => g.id.startsWith(c.key));
      const result = applyGaps(diffDeep(d, u), mine);
      expect(result.unexpected, `${c.key} differs from the demo:\n${result.unexpected.join('\n')}`).toEqual([]);
      expect(result.stale, `known gaps that no longer show up in ${c.key}: remove them`).toEqual([]);

      // Ground truth, straight from the demo data (a bug shared by both renderers would not show as a diff)
      const located = Object.values(c.data.days).flatMap((day) => day.activities);
      expect(userSnap.chips.map((x) => x.key), 'one chip per day').toEqual(Object.keys(c.data.days));
      expect(userSnap.markers.filter((m) => m.kind === 'activity').map((m) => [m.alt, m.lat, m.lng])).toEqual(located.map((a) => [a.name, ...a.coords!]));
      const hotelMarker = userSnap.markers.find((m) => m.kind === 'hotel');
      expect([hotelMarker?.alt, hotelMarker?.lat, hotelMarker?.lng, hotelMarker?.text]).toEqual([c.data.hotel.name, ...c.data.hotel.coords!, 'H']);
      expect(userSnap.hotel?.name).toBe(c.data.hotel.name);
      expect(userSnap.hotelButton).toBe(true);
      Object.entries(c.data.days).forEach(([date, day], di) => {
        const udays = userSnap.days[di]!;
        expect([udays.key, udays.color, udays.hasOptions], date).toEqual([date, day.color, !!day.hasOptions]);
        day.activities.forEach((a, i) => {
          const m = userSnap.markers.find((x) => x.alt === a.name && x.lat === a.coords![0] && x.lng === a.coords![1] && x.kind === 'activity')!;
          expect(m, `${date} ${a.name} has a marker`).toBeTruthy();
          if (a.optional) expect([m.dashed, m.bg], `${a.name} is a dashed purple alternative`).toEqual([true, '#af52de']);
          else expect([m.dashed, m.bg, m.text], `${a.name} is a solid numbered marker`).toEqual([false, day.color, String(i + 1)]);
          expect(udays.items[i]!.optional).toBe(!!a.optional);
          expect(udays.items[i]!.note).toBe(a.notes ? (a.notes.length > 50 ? `${a.notes.slice(0, 50)}...` : a.notes) : '');
        });
      });

      // user-only times are exactly the ones typed
      const times = userTimes(userSnap);
      const expectedTimes: Record<string, string> = {};
      if (UI_CITIES.has(c.key)) {
        Object.entries(c.data.days).forEach(([date, day]) => day.activities.forEach((a, i) => {
          if (USER_TIMES[a.name]) expectedTimes[`${date}#${i}`] = USER_TIMES[a.name]!;
        }));
      }
      expect(times).toEqual(expectedTimes);

      // "View on Maps" opens the demo's link or the activity's own pin; Directions are identical
      Object.entries(c.data.days).forEach(([date, day], di) => {
        day.activities.forEach((a, i) => {
          const du = userSnap.days[di]!.items[i]!;
          if (a.isGeneric) { expect(du.links, `${date} ${a.name}`).toEqual({ maps: null, directions: null }); return; }
          const demoMaps = demoSnap.days[di]!.items[i]!.links.maps;
          const href = du.links.maps;
          expect(href, `${date} ${a.name} has a Maps link`).not.toBeNull();
          if (href !== demoMaps) {
            const p = pointOf(href);
            expect(p, `${date} ${a.name}: link ${href} points at the pin`).not.toBeNull();
            expect(p![0]).toBeCloseTo(a.coords![0], 5);
            expect(p![1]).toBeCloseTo(a.coords![1], 5);
          }
        });
      });
    });
  }
});

test.describe('Demo parity: the comparison itself', () => {
  const sample = (): CitySnapshot => ({
    chips: [{ key: '2026-03-08', label: 'Sun 8', hasOptions: false, title: '' }],
    days: [{ key: '2026-03-08', label: 'Sun 8', color: '#ff3b30', hasOptions: false, badge: '', items: [
      { marker: { text: '1', bg: '#ff3b30' }, optional: false, name: 'Gion', time: '', note: '', links: { maps: 'https://maps.app.goo.gl/x', directions: 'https://d/1' } },
    ] }],
    hotel: { name: 'H', links: { maps: null, directions: null } },
    hotelButton: true,
    markers: [],
    view: { lat: 35, lng: 135, zoom: 12 },
  });

  test('a wrong colour, a missing place, a lost link and a moved pin are all reported with their path', () => {
    const demo = sample();
    const user = sample();
    user.days[0]!.color = '#5ac8fa';
    user.days[0]!.items[0]!.marker.bg = '#5ac8fa';
    user.days[0]!.items[0]!.links.directions = null;
    user.days.push({ ...user.days[0]!, key: '2026-03-09' });
    const [d, u] = normalizeCityPair(demo, user);
    expect(diffDeep(d, u)).toEqual([
      'days.length: demo=1 user=2',
      'days[0].color: demo="#ff3b30" user="#5ac8fa"',
      'days[0].items[0].marker.bg: demo="#ff3b30" user="#5ac8fa"',
      'days[0].items[0].links.directions: demo="https://d/1" user=null',
    ]);
  });

  test('N1: extra Maps links in the trip are fine, a lost one is not; N3: a nearby centre matches, a far one does not', () => {
    const demo = sample();
    demo.days[0]!.items[0]!.links = { maps: null, directions: null };
    const extra = sample();
    extra.days[0]!.items[0]!.links = { maps: 'https://www.google.com/maps/search/?api=1&query=35%2C135', directions: 'https://d/1' };
    extra.view.lat += 0.01;
    expect(diffDeep(...normalizeCityPair(demo, extra))).toEqual([]);
    const lost = sample();
    lost.days[0]!.items[0]!.links.maps = null;
    lost.view.lat += 0.5;
    expect(diffDeep(...normalizeCityPair(sample(), lost))).toEqual([
      'days[0].items[0].links.maps: demo="link" user=null',
      'view.lat: demo=35 user=35.5',
    ]);
  });

  test('a known gap that stops showing up is reported as stale, a new difference as unexpected', () => {
    const gaps = [{ id: 'x', reason: 'r', match: /^a:/ }, { id: 'gone', reason: 'r', match: /^zzz/ }];
    expect(applyGaps(['a: 1', 'b: 2'], gaps)).toEqual({ unexpected: ['b: 2'], stale: ['gone'], explained: ['a: 1'] });
  });
});

export type { DemoCity };
