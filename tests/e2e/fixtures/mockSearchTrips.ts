import type { Page, Route } from '@playwright/test';
import { mockApi } from './mockApi';

/**
 * A user's trips for the search specs: ids are strings, like the real API's UUIDs, and the
 * list endpoint returns bare rows (no destinations) while GET /trips/:id returns the full tree.
 */
export interface SearchAct { name: string; notes?: string }
export interface SearchDay { date: string; label: string; acts: Array<string | SearchAct> }
export interface SearchDest { city: string; hotel?: string; days: SearchDay[] }
export interface SearchTrip { id: string; name: string; dests: SearchDest[] }

export const SPRING: SearchTrip = {
  id: 'trip-spring',
  name: 'Spring in Kansai',
  dests: [
    {
      city: 'Kyoto',
      hotel: 'Gion Ryokan',
      days: [{ date: '2026-04-01', label: 'Temples', acts: [{ name: 'Fushimi Inari', notes: 'Go early' }, 'Ramen alley'] }],
    },
    { city: 'Osaka', days: [{ date: '2026-04-03', label: 'Food', acts: ['Dotonbori ramen'] }] },
  ],
};

export const WINTER: SearchTrip = {
  id: 'trip-winter',
  name: 'Winter in Hokkaido',
  dests: [{ city: 'Sapporo', days: [{ date: '2026-12-10', label: 'Snow', acts: ['Snow festival', 'Ramen Yokocho'] }] }],
};

function toApiTrip(t: SearchTrip): Record<string, unknown> {
  return {
    id: t.id,
    user_id: 'u1',
    name: t.name,
    description: null,
    start_date: null,
    end_date: null,
    cover_image_url: null,
    is_public: false,
    public_slug: null,
    destinations: t.dests.map((d, i) => ({
      id: `${t.id}-d${i}`,
      trip_id: t.id,
      city_name: d.city,
      country: 'Japan',
      lat: 35.0,
      lng: 135.7,
      zoom_level: 12,
      start_date: null,
      end_date: null,
      order_index: i,
      hotel: d.hotel
        ? { id: `${t.id}-h${i}`, name: d.hotel, lat: 35.0, lng: 135.7, check_in_date: null, check_out_date: null, url: null }
        : undefined,
      days: d.days.map((day, j) => ({
        id: `${t.id}-d${i}-day${j}`,
        date: day.date,
        label: day.label,
        color_hex: '#FF6B6B',
        order_index: j,
        activities: day.acts.map((a, k) => {
          const act = typeof a === 'string' ? { name: a } : a;
          return {
            id: `${t.id}-d${i}-day${j}-a${k}`,
            name: act.name,
            lat: 35.0,
            lng: 135.7,
            notes: act.notes ?? null,
            is_optional: false,
            is_generic: false,
            maps_url: '',
            order_index: k,
            time: null,
          };
        }),
      })),
    })),
  };
}

export interface TripsBackendOptions {
  trips?: SearchTrip[];
  /** GET /trips answers with this status instead of the list. */
  listStatus?: number;
  /** GET /trips waits for this promise before answering (race / loading-state specs). */
  listGate?: Promise<void>;
  /** GET /trips never answers (timeout specs). */
  listHangs?: boolean;
}

export interface TripsBackend {
  /** Paths below /api of every request seen, in order (e.g. `GET /trips`). */
  calls: string[];
  /** Change what the backend returns from now on. */
  setTrips(trips: SearchTrip[]): void;
  setListStatus(status: number | undefined): void;
}

/**
 * Trips backend for the search specs. Sits on top of mockApi (which answers /users/me and the
 * writes) and takes over GET /trips and GET /trips/:id.
 */
export async function mockTripsBackend(page: Page, options: TripsBackendOptions = {}): Promise<TripsBackend> {
  await mockApi(page);
  let trips = options.trips ?? [SPRING, WINTER];
  let listStatus = options.listStatus;
  const calls: string[] = [];

  await page.route('**/api/trips**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*?\/api/, '');
    if (request.method() !== 'GET') return route.fallback();
    calls.push(`GET ${path}`);

    if (path === '/trips') {
      if (options.listHangs) return; // never fulfilled
      if (options.listGate) await options.listGate;
      if (listStatus) {
        return route.fulfill({ status: listStatus, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'mock_failure' }) });
      }
      const bare = trips.map((t) => {
        const { destinations: _omit, ...row } = toApiTrip(t);
        void _omit;
        return row;
      });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: bare }) });
    }

    const match = /^\/trips\/([^/]+)$/.exec(path);
    const found = match ? trips.find((t) => t.id === decodeURIComponent(match[1]!)) : undefined;
    if (!found) return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: toApiTrip(found) }) });
  });

  return {
    calls,
    setTrips: (next) => { trips = next; },
    setListStatus: (status) => { listStatus = status; },
  };
}
