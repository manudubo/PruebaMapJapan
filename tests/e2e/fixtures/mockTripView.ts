import type { Page } from '@playwright/test';

/**
 * Trip builders and API overrides for the "view a saved trip" specs (trip.html, dashboard cards).
 * Shapes mirror the API (ApiTrip): NUMERIC coordinates may be strings, unset ones are null.
 * Layer these on top of mockApi(): routes registered later win, `route.fallback()` hands the
 * rest back to it.
 */

export interface PlaceSeed {
  name: string;
  lat: number | string | null;
  lng: number | string | null;
  notes?: string | null;
  optional?: boolean;
  generic?: boolean;
  time?: string | null;
  mapsUrl?: string | null;
}

let nextId = 1000;
const id = (): number => nextId++;

export function place(seed: PlaceSeed): Record<string, unknown> {
  return {
    id: id(),
    name: seed.name,
    lat: seed.lat,
    lng: seed.lng,
    notes: seed.notes ?? null,
    is_optional: seed.optional ?? false,
    is_generic: seed.generic ?? false,
    maps_url: seed.mapsUrl ?? null,
    order_index: 0,
    time: seed.time ?? null,
  };
}

export function day(date: string, label: string | null, color: string | null, places: PlaceSeed[], order = 0) {
  return {
    id: id(),
    date,
    label,
    color_hex: color,
    order_index: order,
    activities: places.map((p, i) => ({ ...place(p), order_index: i })),
  };
}

export interface CitySeed {
  name: string;
  lat?: number | string | null;
  lng?: number | string | null;
  start?: string | null;
  end?: string | null;
  hotel?: { name: string; lat: number | string | null; lng: number | string | null } | null;
  days?: ReturnType<typeof day>[];
  order?: number;
}

export function city(seed: CitySeed, index = 0) {
  return {
    id: id(),
    trip_id: 1,
    city_name: seed.name,
    country: 'Japan',
    start_date: seed.start ?? null,
    end_date: seed.end ?? null,
    lat: seed.lat === undefined ? null : seed.lat,
    lng: seed.lng === undefined ? null : seed.lng,
    zoom_level: 12,
    order_index: seed.order ?? index,
    hotel: seed.hotel ? { id: id(), check_in_date: null, check_out_date: null, url: null, ...seed.hotel } : undefined,
    days: seed.days ?? [],
  };
}

export function trip(overrides: Record<string, unknown> = {}, cities: ReturnType<typeof city>[] = []) {
  return {
    id: 7,
    user_id: 1,
    name: 'Japan 2027',
    description: null,
    start_date: null,
    end_date: null,
    cover_image_url: null,
    is_public: false,
    public_slug: null,
    destinations: cities,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Ready-made trips
// ---------------------------------------------------------------------------

/** ISO date `offset` days from today (local calendar), so countdown/phase specs never go stale. */
export function isoFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Five cities, a return to the first one, hotels, optional + generic activities: the demo, as a saved trip. */
export function japanTrip(startOffset = 40): ReturnType<typeof trip> {
  const s = (n: number): string => isoFromToday(startOffset + n);
  return trip(
    {
      id: 11,
      name: 'Japan 2027',
      description: 'Two weeks of temples, trains and ramen.',
      start_date: s(0),
      end_date: s(13),
      is_public: true,
      public_slug: 'a1b2c3d4-japan',
    },
    [
      city({
        name: 'Tokyo', lat: '35.6762000', lng: '139.6503000', start: s(0), end: s(3),
        hotel: { name: 'Via Inn Akasaka', lat: 35.6747, lng: 139.7371 },
        days: [
          day(s(0), 'Sun 22', '#ff3b30', [
            { name: 'Check-in Via Inn Akasaka', lat: 35.6747, lng: 139.7371 },
            { name: 'Imperial Palace', lat: 35.6852, lng: 139.7528, notes: 'Walk the east gardens', time: '15:00' },
          ]),
          day(s(1), 'Mon 23', '#ff9500', [
            { name: 'Senso-ji', lat: 35.7148, lng: 139.7967, notes: 'Go early' },
            { name: 'Ueno Park', lat: 35.7141, lng: 139.7741, optional: true },
            { name: 'Akihabara', lat: 35.6984, lng: 139.7731, generic: true, optional: true },
          ]),
          day(s(2), 'Tue 24', '#ffcc00', [{ name: 'TeamLab Planets', lat: 35.6491, lng: 139.7876, notes: 'Reserved 19:00' }]),
        ],
      }),
      city({
        name: 'Kyoto', lat: 35.0116, lng: 135.7681, start: s(4), end: s(8),
        hotel: { name: 'Machiya Gion', lat: 35.0036, lng: 135.775 },
        days: [
          day(s(4), 'Fri 26', '#34c759', [
            { name: 'Fushimi Inari', lat: 34.9671, lng: 135.7727 },
            { name: 'Kiyomizu-dera', lat: 34.9949, lng: 135.785 },
          ]),
          day(s(5), 'Sat 27', '#5ac8fa', [{ name: 'Arashiyama Bamboo Grove', lat: 35.0094, lng: 135.6668 }]),
        ],
      }),
      city({
        name: 'Osaka', lat: 34.6937, lng: 135.5023, start: s(9), end: s(10),
        days: [day(s(9), 'Tue 2', '#007aff', [{ name: 'Dotonbori', lat: 34.6687, lng: 135.5013, generic: true }])],
      }),
      city({
        name: 'Hakone', lat: 35.233, lng: 139.107, start: s(11), end: s(12),
        hotel: { name: 'Ryokan Onsen', lat: 35.2324, lng: 139.1069 },
        days: [day(s(11), 'Thu 4', '#af52de', [{ name: 'Lake Ashi cruise', lat: 35.2002, lng: 139.0251 }])],
      }),
      city({
        name: 'Tokyo', lat: 35.6862, lng: 139.715, start: s(12), end: s(13),
        days: [day(s(13), 'Sat 6', '#ff2d55', [{ name: 'Shibuya Sky', lat: 35.6585, lng: 139.7021 }])],
      }),
    ],
  );
}

export const singleCityTrip = trip(
  { id: 12, name: 'Weekend in Kyoto', start_date: '2031-04-10', end_date: '2031-04-12' },
  [
    city({
      name: 'Kyoto', lat: 35.0116, lng: 135.7681, start: '2031-04-10', end: '2031-04-12',
      hotel: { name: 'Machiya Gion', lat: 35.0036, lng: 135.775 },
      days: [day('2031-04-10', 'Fri 10', '#ff3b30', [{ name: 'Fushimi Inari', lat: 34.9671, lng: 135.7727 }])],
    }),
  ],
);

/** Cities and a day exist but nothing is planned yet. */
export const noActivitiesTrip = trip({ id: 13, name: 'Empty plans' }, [
  city({ name: 'Nara', lat: 34.6851, lng: 135.8048, start: '2031-05-01', end: '2031-05-02', days: [day('2031-05-01', 'Day 1', '#ff3b30', [])] }),
  city({ name: 'Kobe', lat: 34.6901, lng: 135.1955 }),
]);

/** Cities without any usable coordinates (null, blank, junk) mixed with located ones. */
export const noCoordsTrip = trip({ id: 14, name: 'Somewhere in Japan' }, [
  city({ name: 'Tokyo', lat: 35.6762, lng: 139.6503, start: '2031-06-01', end: '2031-06-02' }),
  city({
    name: 'Mystery town', lat: null, lng: null, start: '2031-06-03', end: '2031-06-04',
    days: [day('2031-06-03', 'Day 3', '#34c759', [{ name: 'A place with no pin', lat: null, lng: null, notes: 'Ask locals' }])],
  }),
  city({ name: 'Blank coords', lat: '', lng: '  ', start: '2031-06-05', end: '2031-06-05' }),
  city({ name: 'Osaka', lat: 34.6937, lng: 135.5023, start: '2031-06-06', end: '2031-06-07' }),
]);

export const allUnlocatedTrip = trip({ id: 15, name: 'No pins at all' }, [
  city({ name: 'First', start: '2031-07-01', end: '2031-07-02' }),
  city({ name: 'Second', start: '2031-07-03', end: '2031-07-04' }),
]);

export const LONG_NAME = 'Una escapada larguísima por el archipiélago japonés con muchísimas paradas'.repeat(2);
export const UNBROKEN = 'Supercalifragilisticexpialidocious'.repeat(6);

export const longNamesTrip = trip(
  { id: 16, name: LONG_NAME, description: UNBROKEN + ' ' + LONG_NAME, start_date: '2031-08-01', end_date: '2031-08-09' },
  [
    city({
      name: UNBROKEN, lat: 35.6762, lng: 139.6503, start: '2031-08-01', end: '2031-08-05',
      hotel: { name: LONG_NAME, lat: 35.67, lng: 139.65 },
      days: [
        day('2031-08-01', LONG_NAME, '#ff3b30', [
          { name: LONG_NAME, lat: 35.68, lng: 139.7, notes: UNBROKEN },
          { name: UNBROKEN, lat: 35.69, lng: 139.71, notes: LONG_NAME.repeat(3) },
        ]),
      ],
    }),
    city({ name: LONG_NAME, lat: 35.0116, lng: 135.7681, start: '2031-08-06', end: '2031-08-09' }),
  ],
);

export const XSS = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>"\'&amp;';

export const xssTrip = trip(
  { id: 17, name: XSS, description: XSS, start_date: '2031-09-01', end_date: '2031-09-03' },
  [
    city({
      name: XSS, lat: 35.6762, lng: 139.6503, start: '2031-09-01', end: '2031-09-03',
      hotel: { name: XSS, lat: 35.67, lng: 139.65 },
      days: [
        day('2031-09-01', XSS, '#ff3b30', [
          { name: XSS, lat: 35.68, lng: 139.7, notes: XSS, mapsUrl: 'javascript:window.__pwned=3' },
        ]),
      ],
    }),
  ],
);

/** Dates that put the trip in each phase, relative to today. */
export const upcomingTrip = (days = 12) => trip({ id: 21, name: 'Soon', start_date: isoFromToday(days), end_date: isoFromToday(days + 6) }, [
  city({ name: 'Sapporo', lat: 43.0618, lng: 141.3545, start: isoFromToday(days), end: isoFromToday(days + 6) }),
]);
export const activeTrip = trip({ id: 22, name: 'Right now', start_date: isoFromToday(-2), end_date: isoFromToday(5) }, [
  city({ name: 'Fukuoka', lat: 33.5904, lng: 130.4017, start: isoFromToday(-2), end: isoFromToday(5) }),
]);
export const pastTrip = trip({ id: 23, name: 'Last year', start_date: '2019-03-01', end_date: '2019-03-09' }, [
  city({ name: 'Nagoya', lat: 35.1815, lng: 136.9066, start: '2019-03-01', end: '2019-03-09' }),
]);
export const undatedTrip = trip({ id: 24, name: 'Someday', description: 'No dates yet' }, []);

// ---------------------------------------------------------------------------
// API overrides
// ---------------------------------------------------------------------------

const json = (status: number, body: unknown) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

export interface TripRouteOptions {
  /** HTTP status for the answer (default 200). */
  status?: number;
  /** Delay before answering, ms. */
  delayMs?: number;
  /** Fail the connection (API down) instead of answering. */
  abort?: boolean;
  /** Answer with a non-JSON 502 page (gateway error). */
  gatewayError?: boolean;
}

/** Answer GET /api/trips/:id with `body` (owner view). */
export async function routeOwnerTrip(page: Page, body: unknown, options: TripRouteOptions = {}): Promise<{ hits: () => number; setOptions: (o: TripRouteOptions) => void }> {
  let current = options;
  let hits = 0;
  await page.route(/\/api\/trips\/[^/?]+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    hits += 1;
    return answer(route, body, current);
  });
  return { hits: () => hits, setOptions: (o) => { current = o; } };
}

/** Answer GET /api/public/trips/:slug with `body` (shared link). */
export async function routePublicTrip(page: Page, body: unknown, options: TripRouteOptions = {}): Promise<{ hits: () => number; setOptions: (o: TripRouteOptions) => void }> {
  let current = options;
  let hits = 0;
  await page.route(/\/api\/public\/trips\/[^/?]+$/, async (route) => {
    hits += 1;
    return answer(route, body, current);
  });
  return { hits: () => hits, setOptions: (o) => { current = o; } };
}

/** Answer GET /api/trips (the dashboard list). */
export async function routeTripList(page: Page, body: unknown, options: TripRouteOptions = {}): Promise<{ hits: () => number; setOptions: (o: TripRouteOptions) => void }> {
  let current = options;
  let hits = 0;
  await page.route(/\/api\/trips(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    hits += 1;
    return answer(route, body, current);
  });
  return { hits: () => hits, setOptions: (o) => { current = o; } };
}

async function answer(route: import('@playwright/test').Route, body: unknown, o: TripRouteOptions): Promise<void> {
  if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
  if (o.abort) return route.abort('connectionrefused');
  if (o.gatewayError) return route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' });
  const status = o.status ?? 200;
  if (status >= 400) return route.fulfill(json(status, { success: false, error: status === 404 ? 'not_found' : 'error' }));
  return route.fulfill(json(status, { success: true, data: body }));
}
