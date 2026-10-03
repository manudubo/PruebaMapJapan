import type { Page } from '@playwright/test';
import { mockTrip, mockUserApiResponse } from './mockTrip';

export interface ApiCall {
  method: string;
  /** Path below `/api`, without query string, e.g. `/trips/1`. */
  path: string;
  body: unknown;
}

export interface MockApiOptions {
  trips?: unknown[];
  /** Trip returned for GET /trips/:id and /public/trips/:id. */
  trip?: unknown;
  /** When set, every request answers with this status and an error envelope. */
  failWith?: number;
  /** Delay (ms) before answering POST /trips — lets specs probe double-submit. */
  createDelayMs?: number;
  /** Status for GET /trips/:id (default 200), e.g. 404 for a trip the user does not own. */
  tripStatus?: number;
  /** Every non-GET request answers 500 (GETs still succeed) — for save-failure paths. */
  failWrites?: boolean;
}

const json = (status: number, body: unknown) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

/**
 * Backend mock for specs that run without the Worker. Returns the recorded
 * calls so specs can assert on what the UI actually sent (method, path, body).
 */
export async function mockApi(page: Page, options: MockApiOptions = {}): Promise<ApiCall[]> {
  const calls: ApiCall[] = [];
  const trips = options.trips ?? [mockTrip];
  const trip = options.trip ?? mockTrip;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*?\/api/, '');
    const raw = request.postData();
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    calls.push({ method: request.method(), path, body });

    if (options.failWith) {
      return route.fulfill(json(options.failWith, { success: false, error: 'mock_failure' }));
    }
    if (options.failWrites && request.method() !== 'GET') {
      return route.fulfill(json(500, { success: false, error: 'mock_write_failure' }));
    }
    if (path === '/users/me') return route.fulfill(json(200, mockUserApiResponse));
    if (path === '/trips' && request.method() === 'POST') {
      if (options.createDelayMs) await new Promise((r) => setTimeout(r, options.createDelayMs));
      // Mirror the Worker's Zod schema: a blank name is a 422, never a created trip.
      const name = (body as { name?: unknown } | null)?.name;
      if (typeof name !== 'string' || name.trim() === '') {
        return route.fulfill(json(422, { success: false, error: 'validation_error' }));
      }
      const created = { ...(mockTrip as object), ...(body as object), id: 99 };
      return route.fulfill(json(201, { success: true, data: created }));
    }
    if (path === '/trips') return route.fulfill(json(200, { success: true, data: trips }));
    if (request.method() === 'GET' && /^\/(public\/)?trips\/\d+$/.test(path)) {
      if (options.tripStatus && options.tripStatus !== 200) {
        return route.fulfill(json(options.tripStatus, { success: false, error: 'not_found' }));
      }
      return route.fulfill(json(200, { success: true, data: trip }));
    }
    // Nested writes (destinations/hotel/days/activities): echo the payload back like the Worker does.
    if (path.startsWith('/trips/') && request.method() !== 'GET') {
      if (request.method() === 'DELETE' || path.endsWith('/reorder')) return route.fulfill({ status: 204 });
      if (request.method() === 'PATCH' && /^\/trips\/\d+$/.test(path)) {
        return route.fulfill(json(200, { success: true, data: { ...(trip as object), ...(body as object) } }));
      }
      const lastId = Number(path.split('/').filter((seg) => /^\d+$/.test(seg)).pop() ?? 0);
      const status = request.method() === 'POST' ? 201 : 200;
      const id = request.method() === 'POST' ? 50 + calls.length : lastId;
      return route.fulfill(json(status, { success: true, data: { days: [], hotel: null, ...(body as object), id } }));
    }
    return route.fulfill(json(200, { success: true, data: [] }));
  });

  return calls;
}
