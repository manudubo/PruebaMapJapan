import type { Page, Route } from '@playwright/test';
import { mockUserApiResponse } from './mockTrip';

/**
 * Stateful in-memory backend for the trip editor: what the editor writes is what
 * a reload reads back, like the real API (ids assigned on create, nested
 * destinations -> days -> activities, order by order_index, cascade deletes).
 * Also answers /geocode from a small gazetteer, with switchable failure modes.
 */

export interface ApiCall { method: string; path: string; body: unknown }

type Row = Record<string, unknown> & { id: number };
interface Activity extends Row { order_index: number }
interface Day extends Row { activities: Activity[]; order_index: number }
interface Dest extends Row { days: Day[]; hotel: Row | null; order_index: number }
interface Trip extends Row { destinations: Dest[] }

export const GAZETTEER: Array<{ q: RegExp; hits: Array<{ lat: string; lon: string; display_name: string }> }> = [
  { q: /tokyo|tokio/i, hits: [{ lat: '35.6768', lon: '139.7638', display_name: 'Tokyo, Japan' }] },
  { q: /kyoto/i, hits: [{ lat: '35.0116', lon: '135.7681', display_name: 'Kyoto, Kyoto Prefecture, Japan' }] },
  { q: /osaka/i, hits: [{ lat: '34.6937', lon: '135.5023', display_name: 'Osaka, Osaka Prefecture, Japan' }] },
  { q: /kinkaku|golden/i, hits: [{ lat: '35.0394', lon: '135.7292', display_name: 'Kinkaku-ji, Kita Ward, Kyoto, Japan' }] },
  { q: /fushimi/i, hits: [{ lat: '34.9671', lon: '135.7727', display_name: 'Fushimi Inari Taisha, Fushimi Ward, Kyoto, Japan' }] },
  { q: /granvia/i, hits: [{ lat: '34.9858', lon: '135.7588', display_name: 'Hotel Granvia Kyoto, Shimogyo Ward, Kyoto, Japan' }] },
];

export interface StoreOptions {
  trips?: unknown[];
  geocode?: 'ok' | 'down' | 'empty' | 'slow';
  /** Delay (ms) added to every write — to probe double submit and in-flight states. */
  writeDelayMs?: number;
}

export interface TripStore {
  calls: ApiCall[];
  trips: Trip[];
  /** Fail the next N non-GET calls with this status (or 'abort' for a network error). */
  failNext(status: number | 'abort', count?: number, match?: RegExp): void;
  failAlways(status: number | 'abort' | null, match?: RegExp): void;
  setGeocode(mode: NonNullable<StoreOptions['geocode']>): void;
  writes(method?: string): ApiCall[];
  geocodeCalls(): number;
}

const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

export async function mockTripStore(page: Page, options: StoreOptions = {}): Promise<TripStore> {
  const calls: ApiCall[] = [];
  let nextId = 1000;
  const trips: Trip[] = ((options.trips ?? []) as Trip[]).map((t) => JSON.parse(JSON.stringify(t)) as Trip);
  let geocode = options.geocode ?? 'ok';
  let geocodeCount = 0;
  let failures: Array<{ status: number | 'abort'; left: number; match?: RegExp }> = [];
  let always: { status: number | 'abort'; match?: RegExp } | null = null;

  const sorted = <T extends { order_index: number }>(a: T[]): T[] => a.sort((x, y) => x.order_index - y.order_index);

  function find(tripId: number): Trip | undefined { return trips.find((t) => t.id === tripId); }

  function view(t: Trip): Trip {
    const c = JSON.parse(JSON.stringify(t)) as Trip;
    sorted(c.destinations);
    for (const d of c.destinations) {
      sorted(d.days);
      for (const day of d.days) sorted(day.activities);
    }
    return c;
  }

  await page.route('**/api/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*?\/api/, '');
    const method = req.method();
    let body: Record<string, unknown> = {};
    const raw = req.postData();
    if (raw) { try { body = JSON.parse(raw) as Record<string, unknown>; } catch { body = {}; } }
    calls.push({ method, path, body });

    if (method === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/users/me') return route.fulfill(json(200, { success: true, data: (mockUserApiResponse as { data: unknown }).data }));

    if (path === '/geocode') {
      geocodeCount += 1;
      if (geocode === 'down') return route.fulfill(json(502, { success: false, error: 'bad_gateway' }));
      if (geocode === 'empty') return route.fulfill(json(200, { success: true, data: [] }));
      if (geocode === 'slow') await new Promise((r) => setTimeout(r, 1500));
      const q = url.searchParams.get('q') ?? '';
      const hit = GAZETTEER.find((g) => g.q.test(q));
      return route.fulfill(json(200, { success: true, data: hit ? hit.hits : [] }));
    }

    if (method !== 'GET') {
      const fail = failures.find((f) => f.left > 0 && (!f.match || f.match.test(`${method} ${path}`)));
      const forced = fail ?? (always && (!always.match || always.match.test(`${method} ${path}`)) ? always : null);
      if (forced) {
        if (fail) fail.left -= 1;
        if (forced.status === 'abort') return route.abort('failed');
        return route.fulfill(json(forced.status, forced.status === 422
          ? { success: false, error: 'validation', issues: [{ path: 'name', message: 'Rejected by the mock' }] }
          : { success: false, error: 'mock_failure' }));
      }
      if (options.writeDelayMs) await new Promise((r) => setTimeout(r, options.writeDelayMs));
    }

    const ok = (data: unknown, status = 200) => route.fulfill(json(status, { success: true, data }));
    const notFound = () => route.fulfill(json(404, { success: false, error: 'not_found' }));
    const parts = path.split('/').filter(Boolean); // trips, id, destinations, id, days, id, activities, id

    if (parts[0] !== 'trips') return route.fulfill(json(200, { success: true, data: [] }));

    if (parts.length === 1) {
      if (method === 'GET') return ok(trips.map(view));
      if (method === 'POST') {
        const name = body['name'];
        if (typeof name !== 'string' || !name.trim() || name.length > 255) return route.fulfill(json(422, { success: false, error: 'validation', issues: [{ path: 'name', message: 'name is required' }] }));
        const t: Trip = { id: nextId++, user_id: 1, name, description: null, start_date: null, end_date: null, cover_image_url: null, is_public: false, public_slug: null, ...body, destinations: [] } as Trip;
        trips.push(t);
        return ok(view(t), 201);
      }
    }

    const trip = find(Number(parts[1]));
    if (!trip) return notFound();
    if (parts.length === 2) {
      if (method === 'GET') return ok(view(trip));
      if (method === 'PATCH') {
        Object.assign(trip, body);
        if (trip.is_public && !trip.public_slug) trip.public_slug = `slug-${trip.id}`;
        return ok(view(trip));
      }
      if (method === 'DELETE') { trips.splice(trips.indexOf(trip), 1); return route.fulfill({ status: 204 }); }
    }

    if (parts[2] === 'destinations') {
      if (parts.length === 3 && method === 'POST') {
        const d: Dest = { id: nextId++, trip_id: trip.id, zoom_level: 12, order_index: 0, ...body, days: [], hotel: null } as Dest;
        trip.destinations.push(d);
        return ok({ ...d, days: undefined }, 201);
      }
      const dest = trip.destinations.find((d) => d.id === Number(parts[3]));
      if (!dest) return notFound();
      if (parts.length === 4) {
        if (method === 'PATCH') { Object.assign(dest, body); return ok(dest); }
        if (method === 'DELETE') { trip.destinations.splice(trip.destinations.indexOf(dest), 1); return route.fulfill({ status: 204 }); }
      }
      if (parts[4] === 'hotel') {
        if (method === 'PUT') { dest.hotel = { id: dest.hotel?.id ?? nextId++, ...body }; return ok(dest.hotel); }
        if (method === 'DELETE') { dest.hotel = null; return route.fulfill({ status: 204 }); }
        if (method === 'GET') return dest.hotel ? ok(dest.hotel) : route.fulfill(json(404, { success: false, code: 'hotel_not_found' }));
      }
      if (parts[4] === 'days') {
        if (parts.length === 5 && method === 'POST') {
          const day: Day = { id: nextId++, order_index: 0, label: null, color_hex: null, ...body, activities: [] } as Day;
          dest.days.push(day);
          return ok({ ...day, activities: undefined }, 201);
        }
        const day = dest.days.find((d) => d.id === Number(parts[5]));
        if (!day) return notFound();
        if (parts.length === 6) {
          if (method === 'PATCH') { Object.assign(day, body); return ok(day); }
          if (method === 'DELETE') { dest.days.splice(dest.days.indexOf(day), 1); return route.fulfill({ status: 204 }); }
        }
        if (parts[6] === 'activities') {
          if (parts.length === 7 && method === 'POST') {
            const a: Activity = { id: nextId++, order_index: 0, notes: null, time: null, maps_url: null, is_optional: false, is_generic: false, lat: null, lng: null, ...body } as Activity;
            day.activities.push(a);
            return ok(a, 201);
          }
          if (parts[7] === 'reorder' && method === 'POST') {
            const ids = (body['ordered_ids'] as number[]) ?? [];
            ids.forEach((id, i) => { const a = day.activities.find((x) => x.id === id); if (a) a.order_index = i; });
            return ok(sorted(day.activities.slice()));
          }
          const act = day.activities.find((a) => a.id === Number(parts[7]));
          if (!act) return notFound();
          if (method === 'PATCH') { Object.assign(act, body); return ok(act); }
          if (method === 'DELETE') { day.activities.splice(day.activities.indexOf(act), 1); return route.fulfill({ status: 204 }); }
        }
      }
    }
    return notFound();
  }).then(() => undefined);

  return {
    calls,
    trips,
    failNext(status, count = 1, match) { failures.push({ status, left: count, match }); },
    failAlways(status, match) { always = status === null ? null : { status, match }; failures = []; },
    setGeocode(mode) { geocode = mode; },
    writes: (method) => calls.filter((c) => c.method !== 'GET' && c.path !== '/geocode' && (!method || c.method === method)),
    geocodeCalls: () => geocodeCount,
  };
}

export const emptyTrip = (over: Record<string, unknown> = {}) => ({
  id: 1, user_id: 1, name: 'Japan 2026', description: null, start_date: '2026-02-22', end_date: '2026-03-02',
  cover_image_url: null, is_public: false, public_slug: null, destinations: [], ...over,
});
