/**
 * Typed API client for the travel itinerary backend.
 *
 * All authenticated requests attach a Bearer token obtained from Keycloak.
 * Unauthenticated users can still access public trips via getPublicTrip().
 */

import { getToken, isAuthenticated, login } from '@/auth/keycloak';
import { showToast } from '@/modules/toast';
import type {
  ApiTrip,
  ApiDestination,
  ApiDay,
  ApiActivity,
  ApiHotel,
  ApiUser,
} from '@/types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_URL: string =
  (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:8787/api';

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function buildHeaders(auth: boolean): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (import.meta.env.DEV && auth) {
    console.debug(`[auth] buildHeaders: isAuthenticated=${isAuthenticated()}`);
  }

  if (auth && isAuthenticated()) {
    try {
      const token = await getToken();
      headers['Authorization'] = `Bearer ${token}`;
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[auth] getToken threw:', err);
    }
  }

  return headers;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? `API error ${status}`);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  const headers = await buildHeaders(auth);

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    const redirectTarget = new URL('dashboard.html', window.location.href).href;
    if (import.meta.env.DEV) {
      console.warn(`[auth] 401 on ${method} ${path} — isAuthenticated=${isAuthenticated()}, redirecting to ${redirectTarget}`);
    }
    showToast('Session expired — redirecting to login', 'info');
    setTimeout(() => { void login(redirectTarget); }, 1500);
    return new Promise<never>(() => { /* intentionally never resolves — prevents double-toast */ });
  }

  if (!response.ok) {
    const envelope = await response.json().catch(() => null) as { code?: string } | null;
    throw new ApiError(response.status, envelope?.code ?? 'unknown');
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  const envelope = await response.json() as ApiEnvelope<T>;
  if (!envelope.success) {
    throw new Error(envelope.error ?? 'API error');
  }

  return envelope.data as T;
}

// ---------------------------------------------------------------------------
// Trip endpoints
// ---------------------------------------------------------------------------

/** List all trips that belong to the authenticated user. */
export async function getMyTrips(): Promise<ApiTrip[]> {
  return request<ApiTrip[]>('/trips', { auth: true });
}

/** Get a single trip with all destinations, days, and activities. */
export async function getTrip(tripId: string): Promise<ApiTrip> {
  return request<ApiTrip>(`/trips/${tripId}`, { auth: true });
}

/** Create a new trip. */
export async function createTrip(
  data: Partial<Omit<ApiTrip, 'id' | 'user_id' | 'destinations'>>
): Promise<ApiTrip> {
  return request<ApiTrip>('/trips', { method: 'POST', body: data, auth: true });
}

/** Update an existing trip. */
export async function updateTrip(
  tripId: string,
  data: Partial<Omit<ApiTrip, 'id' | 'user_id' | 'destinations'>>
): Promise<ApiTrip> {
  return request<ApiTrip>(`/trips/${tripId}`, { method: 'PATCH', body: data, auth: true });
}

/** Delete a trip. */
export async function deleteTrip(tripId: string): Promise<void> {
  return request<void>(`/trips/${tripId}`, { method: 'DELETE', auth: true });
}

// ---------------------------------------------------------------------------
// Destination endpoints
// ---------------------------------------------------------------------------

/** Add a destination to a trip. */
export async function createDestination(
  tripId: string,
  data: Partial<Omit<ApiDestination, 'id' | 'trip_id' | 'hotel' | 'days'>>
): Promise<ApiDestination> {
  return request<ApiDestination>(`/trips/${tripId}/destinations`, {
    method: 'POST',
    body: data,
    auth: true,
  });
}

/** Update a destination. */
export async function updateDestination(
  tripId: string,
  destId: string,
  data: Partial<Omit<ApiDestination, 'id' | 'trip_id' | 'hotel' | 'days'>>
): Promise<ApiDestination> {
  return request<ApiDestination>(`/trips/${tripId}/destinations/${destId}`, {
    method: 'PATCH',
    body: data,
    auth: true,
  });
}

/** Delete a destination. */
export async function deleteDestination(tripId: string, destId: string): Promise<void> {
  return request<void>(`/trips/${tripId}/destinations/${destId}`, {
    method: 'DELETE',
    auth: true,
  });
}

// ---------------------------------------------------------------------------
// Day endpoints
// ---------------------------------------------------------------------------

/** Add a day to a destination. */
export async function createDay(
  tripId: string,
  destId: string,
  data: Partial<Omit<ApiDay, 'id' | 'activities'>>
): Promise<ApiDay> {
  return request<ApiDay>(`/trips/${tripId}/destinations/${destId}/days`, {
    method: 'POST',
    body: data,
    auth: true,
  });
}

/** Update a day. */
export async function updateDay(
  tripId: string,
  destId: string,
  dayId: string,
  data: Partial<Omit<ApiDay, 'id' | 'activities'>>
): Promise<ApiDay> {
  return request<ApiDay>(
    `/trips/${tripId}/destinations/${destId}/days/${dayId}`,
    { method: 'PATCH', body: data, auth: true }
  );
}

/** Delete a day (cascades to activities). */
export async function deleteDay(
  tripId: string,
  destId: string,
  dayId: string
): Promise<void> {
  return request<void>(
    `/trips/${tripId}/destinations/${destId}/days/${dayId}`,
    { method: 'DELETE', auth: true }
  );
}

// ---------------------------------------------------------------------------
// Hotel endpoints
// ---------------------------------------------------------------------------

/** Get the hotel for a destination (null if none). */
export async function getHotel(tripId: string, destId: string): Promise<ApiHotel> {
  return request<ApiHotel>(
    `/trips/${tripId}/destinations/${destId}/hotel`,
    { auth: true }
  );
}

/** Create or replace the hotel for a destination. */
export async function upsertHotel(
  tripId: string,
  destId: string,
  data: Partial<Omit<ApiHotel, 'id'>>
): Promise<ApiHotel> {
  return request<ApiHotel>(
    `/trips/${tripId}/destinations/${destId}/hotel`,
    { method: 'PUT', body: data, auth: true }
  );
}

/** Delete the hotel for a destination. */
export async function deleteHotel(tripId: string, destId: string): Promise<void> {
  return request<void>(
    `/trips/${tripId}/destinations/${destId}/hotel`,
    { method: 'DELETE', auth: true }
  );
}

// ---------------------------------------------------------------------------
// Activity endpoints
// ---------------------------------------------------------------------------

/** Add an activity to a day. */
export async function createActivity(
  tripId: string,
  destId: string,
  dayId: string,
  data: Partial<Omit<ApiActivity, 'id'>>
): Promise<ApiActivity> {
  return request<ApiActivity>(
    `/trips/${tripId}/destinations/${destId}/days/${dayId}/activities`,
    { method: 'POST', body: data, auth: true }
  );
}

/** Update an activity. */
export async function updateActivity(
  tripId: string,
  destId: string,
  dayId: string,
  actId: string,
  data: Partial<Omit<ApiActivity, 'id'>>
): Promise<ApiActivity> {
  return request<ApiActivity>(
    `/trips/${tripId}/destinations/${destId}/days/${dayId}/activities/${actId}`,
    { method: 'PATCH', body: data, auth: true }
  );
}

/** Delete an activity. */
export async function deleteActivity(
  tripId: string,
  destId: string,
  dayId: string,
  actId: string
): Promise<void> {
  return request<void>(
    `/trips/${tripId}/destinations/${destId}/days/${dayId}/activities/${actId}`,
    { method: 'DELETE', auth: true }
  );
}

/**
 * Reorder activities within a day.
 * Uses POST (not PATCH) — backend endpoint is tripsRoute.post('.../reorder').
 */
export async function reorderActivities(
  tripId: string,
  destId: string,
  dayId: string,
  orderedIds: number[]
): Promise<void> {
  return request<void>(
    `/trips/${tripId}/destinations/${destId}/days/${dayId}/activities/reorder`,
    { method: 'POST', body: { ordered_ids: orderedIds }, auth: true }
  );
}

// ---------------------------------------------------------------------------
// Public trip endpoint (no auth required)
// ---------------------------------------------------------------------------

/** Fetch a public trip without authentication. */
export async function getPublicTrip(slug: string): Promise<ApiTrip> {
  return request<ApiTrip>(`/public/trips/${slug}`, { auth: false });
}

// ---------------------------------------------------------------------------
// User endpoints
// ---------------------------------------------------------------------------

/** Get the authenticated user's profile. */
export async function getMe(): Promise<ApiUser> {
  return request<ApiUser>('/users/me', { auth: true });
}

/** Update the authenticated user's profile. */
export async function updateMe(
  data: Partial<Omit<ApiUser, 'id' | 'keycloak_id'>>
): Promise<ApiUser> {
  return request<ApiUser>('/users/me', { method: 'PATCH', body: data, auth: true });
}
