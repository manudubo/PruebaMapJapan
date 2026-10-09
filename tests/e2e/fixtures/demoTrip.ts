import { expect, type Locator, type Page } from '@playwright/test';
import { ITINERARY } from '../../../frontend/src/data/itinerary';
import type { Activity, CityData } from '../../../frontend/src/types';
import type { TripStore } from './mockTripStore';
import { saved } from './editorHelpers';

/**
 * The demo itinerary (frontend/src/data/itinerary.ts) turned into the USER ACTIONS the trip
 * editor needs, so a spec can rebuild the demo by hand and compare the result with the demo.
 *
 *  - `DemoCity`           : one city of the demo, with the dates its day keys imply.
 *  - `GeocoderMock`       : answers /api/geocode with the demo's coordinates for exactly the text
 *                           the "user" types (a place name), so the pins are the demo's pins.
 *  - `buildCityInEditor`  : drives the real UI: dates, zoom, day by day places (search, then name,
 *                           time, notes, alternative / general-area flags), the hotel.
 *  - `seedCityInStore`    : writes the same city straight into the stateful API mock, row by row
 *                           in the API's shape. Used for the cities the spec does not click through.
 */

export interface DemoCity {
  key: string;
  data: CityData;
  /** First / last day of the city (from the day keys). */
  start: string;
  end: string;
}

export const TRIP_NAME = 'Japan 2026';

export function demoCities(): DemoCity[] {
  return Object.entries(ITINERARY).map(([key, data]) => {
    const dates = Object.keys(data.days).sort();
    return { key, data, start: dates[0]!, end: dates[dates.length - 1]! };
  });
}

export const tripStart = (cities = demoCities()): string => cities[0]!.start;
export const tripEnd = (cities = demoCities()): string => cities[cities.length - 1]!.end;

// ---------------------------------------------------------------------------
// Geocoder
// ---------------------------------------------------------------------------

export interface GeoHit { lat: number; lng: number; label: string }

/**
 * `/api/geocode?q=` answers from a table the driver fills right before it types: the demo has
 * the same place name at different coordinates ("Free day" in Kyoto and in Osaka), so the table is
 * per query, not global. Register AFTER mockTripStore (later routes win; unknown queries fall back).
 */
export class GeocoderMock {
  private hits = new Map<string, GeoHit>();
  searches: string[] = [];

  async install(page: Page): Promise<void> {
    await page.route((url) => url.pathname.endsWith('/api/geocode'), async (route) => {
      if (route.request().method() !== 'GET') return route.fallback(); // CORS preflight: the store answers
      const q = new URL(route.request().url()).searchParams.get('q') ?? '';
      const hit = this.hits.get(q);
      if (!hit) return route.fallback();
      this.searches.push(q);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [{ lat: String(hit.lat), lon: String(hit.lng), display_name: hit.label }] }),
      });
    });
  }

  expect(query: string, coords: [number, number], label: string): void {
    this.hits.set(query, { lat: coords[0], lng: coords[1], label });
  }
}

// ---------------------------------------------------------------------------
// Editor driver
// ---------------------------------------------------------------------------

export interface CityPin { query: string; coords: [number, number] }

/** Search `query` in the "Add a destination" box and pick the hit. */
export async function addDestinationInEditor(page: Page, geo: GeocoderMock, query: string, pin: [number, number], label: string): Promise<void> {
  geo.expect(query, pin, label);
  const box = page.locator('#dest-search');
  await box.fill(query);
  await box.press('Enter');
  const option = page.locator('#dest-search-list .place-option:not(.place-option--free)').first();
  await expect(option).toBeVisible();
  await option.click();
}

async function setRange(input: Locator, value: number): Promise<void> {
  await input.evaluate((el: HTMLInputElement, v: number) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

export interface UserTimes { [activityName: string]: string }

export interface BuildOptions {
  /** Clock times the user types for some places (the demo has none): name -> HH:MM. */
  times?: UserTimes;
}

/** Everything one activity needs besides its pin: shown under the row's "Details". */
function needsDetails(a: Activity): boolean {
  return !!(a.notes || a.optional || a.isGeneric);
}

async function addActivityInEditor(page: Page, geo: GeocoderMock, city: DemoCity, a: Activity, count: number, options: BuildOptions): Promise<void> {
  const list = page.locator('#activity-list > li');
  if (a.coords) {
    geo.expect(a.name, a.coords, `${a.name}, ${city.data.name}, Japan`);
    const box = page.locator('#act-search');
    await box.fill(a.name);
    await box.press('Enter');
    const option = page.locator('#act-search-list .place-option:not(.place-option--free)').first();
    await expect(option).toBeVisible();
    await option.click();
  } else {
    throw new Error(`demo activity without coordinates: ${a.name}`);
  }
  await expect(list).toHaveCount(count + 1);
  const row = list.nth(count);
  await expect(row.locator('.te-act-name')).toHaveValue(a.name);

  const time = options.times?.[a.name];
  if (time) await row.locator('[data-role="time"]').fill(time);

  if (needsDetails(a)) {
    await row.locator('[data-role="toggle"]').click();
    if (a.notes) await row.locator('[data-role="notes"]').fill(a.notes);
    if (a.optional) await row.getByLabel('Alternative option').check();
    if (a.isGeneric) await row.getByLabel('General area, not an exact spot').check();
    await row.locator('[data-role="toggle"]').click(); // collapse again: keeps the list short
  }
}

/** Open stop `index` of the route, fill it like a user would, return to the route. */
export async function buildCityInEditor(page: Page, geo: GeocoderMock, city: DemoCity, index: number, options: BuildOptions = {}): Promise<void> {
  await page.locator('.te-step[data-step="route"]').click();
  await page.locator('#destinations-list > li').nth(index).locator('.te-dest-open').click();
  await expect(page.locator('#city-title')).toHaveText(city.data.name);

  // dates, then zoom
  await page.locator('#dest-start').fill(city.start);
  await page.locator('#dest-end').fill(city.end);
  await expect(page.locator('#day-chips .day-btn')).toHaveCount(Object.keys(city.data.days).length);
  await setRange(page.locator('#dest-zoom'), city.data.zoom);

  // days, in calendar order
  for (const [date, day] of Object.entries(city.data.days)) {
    await page.locator(`#day-chips [data-date="${date}"]`).click();
    await expect(page.locator('#day-chips .day-btn.active')).toHaveAttribute('data-date', date);
    for (let i = 0; i < day.activities.length; i++) {
      await addActivityInEditor(page, geo, city, day.activities[i]!, i, options);
    }
    await chooseDayColor(page, day.color);
  }

  // hotel
  geo.expect(city.data.hotel.name, city.data.hotel.coords!, `${city.data.hotel.name}, ${city.data.name}, Japan`);
  const hotel = page.locator('#hotel-search');
  await hotel.fill(city.data.hotel.name);
  await hotel.press('Enter');
  const option = page.locator('#hotel-search-list .place-option:not(.place-option--free)').first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.locator('#hotel-name')).toHaveValue(city.data.hotel.name);
  await saved(page);
}

/** Pick the colour of the selected day: Day options -> Day colour. */
export async function chooseDayColor(page: Page, color: string): Promise<void> {
  const options = page.locator('#day-options');
  if (!(await options.evaluate((el: HTMLDetailsElement) => el.open))) await options.locator('summary').click();
  await page.locator(`#day-color input[value="${color}"]`).check();
  await expect(page.locator('#day-chips .day-btn.active .te-day-dot')).toHaveCSS('background-color', hexToRgb(color));
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
}

// ---------------------------------------------------------------------------
// Store seeding (the cities the spec does not click through)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/**
 * Write one city's days, places and hotel into the in-memory API for destination `destIndex`
 * (already created through the UI, so it has its pin). Same row shapes the API returns:
 * NUMERIC coordinates, order_index per sibling, `maps_url` like the editor's
 * "Use the pin as the link" and `is_optional` / `is_generic` flags.
 */
export function seedCityInStore(store: TripStore, destIndex: number, city: DemoCity, firstId: number): number {
  let id = firstId;
  const dest = store.trips[0]!.destinations[destIndex] as unknown as Row & { days: Row[] };
  dest['start_date'] = city.start;
  dest['end_date'] = city.end;
  dest['zoom_level'] = city.data.zoom;
  dest['hotel'] = {
    id: id++, name: city.data.hotel.name, lat: city.data.hotel.coords![0], lng: city.data.hotel.coords![1],
    check_in_date: null, check_out_date: null, url: null,
  };
  dest.days = Object.entries(city.data.days).map(([date, day], dayIndex) => ({
    id: id++,
    date,
    label: null,
    color_hex: day.color,
    order_index: dayIndex,
    activities: day.activities.map((a, i) => ({
      id: id++,
      name: a.name,
      lat: a.coords![0],
      lng: a.coords![1],
      notes: a.notes,
      time: null,
      maps_url: `https://www.google.com/maps/search/?api=1&query=${a.coords![0]}%2C${a.coords![1]}`,
      is_optional: !!a.optional,
      is_generic: !!a.isGeneric,
      order_index: i,
    })),
  }));
  return id;
}
