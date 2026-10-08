// Dashboard trip list: skeleton -> slow notice (3s) -> error with retry, empty state, late answers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/auth/keycloak', () => ({
  keycloak: { login: vi.fn() },
  loginRedirectUri: vi.fn(() => 'https://app.test/dashboard.html'),
  initKeycloak: vi.fn(() => new Promise(() => {})),
  retryAuth: vi.fn(),
  getAuthStatus: vi.fn().mockReturnValue('pending'),
  getAuthUnavailableReason: vi.fn().mockReturnValue(null),
  onAuthStatusChange: vi.fn().mockReturnValue(() => {}),
  getUserInfo: vi.fn().mockReturnValue(null),
  getToken: vi.fn(),
  login: vi.fn(),
}));
vi.mock('@/components/Navbar', () => ({}));
vi.mock('@/components/SearchBar', () => ({}));
vi.mock('@/modules/passkeyCampaign', () => ({ checkPasskeyCampaign: vi.fn(), createPrefsStore: vi.fn(), runNewUserOnboarding: vi.fn() }));

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getMyTrips: vi.fn(),
  createTrip: vi.fn(),
  updateMe: vi.fn(),
  EMAIL_NOT_VERIFIED_EVENT: 'travelmap:email-not-verified',
  ApiError: class ApiError extends Error {},
  apiUrl: (p: string) => `http://localhost/api${p}`,
}));
vi.mock('@/api/client', () => api);

import { loadTrips, SLOW_TRIPS_MS } from '@/pages/dashboard';
import type { ApiTrip } from '@/types';

const trip = (id: string, name = `Trip ${id}`): ApiTrip => ({
  id, user_id: 'u', name, description: null, start_date: null, end_date: null,
  cover_image_url: null, is_public: false, public_slug: null, destinations: [],
});

const grid = (): HTMLElement => document.getElementById('trips-grid')!;
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="trips-grid" hidden></div><div id="create-trip-overlay" hidden></div>';
  api.getMyTrips.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('dashboard trip list states', () => {
  it('shows skeleton cards at once, then the trips', async () => {
    const d = deferred<ApiTrip[]>();
    api.getMyTrips.mockReturnValue(d.promise);
    const p = loadTrips();
    expect(grid().hidden).toBe(false);
    expect(grid().getAttribute('aria-busy')).toBe('true');
    expect(grid().querySelectorAll('.trip-card--skeleton')).toHaveLength(3);
    expect(grid().textContent).not.toMatch(/Loading trips\.\.\./);

    d.resolve([trip('1'), trip('2')]);
    await p;
    expect(grid().querySelectorAll('.trip-card:not(.trip-card--skeleton)')).toHaveLength(2);
    expect(grid().hasAttribute('aria-busy')).toBe(false);
  });

  it('no trips: the empty state with "Create your first trip" and "See the demo"', async () => {
    api.getMyTrips.mockResolvedValue([]);
    await loadTrips();
    expect(grid().querySelector('#empty-state-create-btn')?.textContent).toBe('Create your first trip');
    expect(grid().querySelector('#empty-state-demo-link')?.getAttribute('href')).toBe('index.html#demo');
  });

  it('a failing API shows an error with Try again, never an empty dashboard', async () => {
    api.getMyTrips.mockRejectedValue(new TypeError('Failed to fetch'));
    await loadTrips();
    expect(grid().querySelector('[role="alert"]')).not.toBeNull();
    expect(grid().querySelector('#empty-state-create-btn')).toBeNull();
    expect(grid().querySelector('#trips-retry-btn')).not.toBeNull();
  });

  it('Try again after an error fetches again and shows the trips', async () => {
    api.getMyTrips.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([trip('9')]);
    await loadTrips();
    grid().querySelector<HTMLButtonElement>('#trips-retry-btn')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getMyTrips).toHaveBeenCalledTimes(2);
    expect(grid().querySelector('.trip-card-title')?.textContent).toBe('Trip 9');
    expect(grid().querySelector('#trips-error')).toBeNull();
  });

  it('a slow API: notice with Try again after 3s, and the late answer still lands', async () => {
    const d = deferred<ApiTrip[]>();
    api.getMyTrips.mockReturnValue(d.promise);
    const p = loadTrips();
    await vi.advanceTimersByTimeAsync(SLOW_TRIPS_MS - 1);
    expect(grid().querySelector('#trips-slow')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(SLOW_TRIPS_MS).toBeLessThanOrEqual(3000);
    expect(grid().querySelector('#trips-slow')?.getAttribute('role')).toBe('status');
    expect(grid().querySelector('#trips-slow-retry')).not.toBeNull();

    d.resolve([trip('1')]);
    await p;
    expect(grid().querySelector('#trips-slow')).toBeNull();
    expect(grid().querySelectorAll('.trip-card:not(.trip-card--skeleton)')).toHaveLength(1);
  });

  it('Try again while slow: the first answer wins, the stale one is ignored', async () => {
    const first = deferred<ApiTrip[]>();
    const second = deferred<ApiTrip[]>();
    api.getMyTrips.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const p1 = loadTrips();
    await vi.advanceTimersByTimeAsync(SLOW_TRIPS_MS);
    grid().querySelector<HTMLButtonElement>('#trips-slow-retry')!.click();
    second.resolve([trip('B')]);
    await vi.advanceTimersByTimeAsync(0);
    first.resolve([trip('A')]);
    await p1;
    expect(grid().querySelectorAll('.trip-card-title')).toHaveLength(1);
    expect(grid().querySelector('.trip-card-title')?.textContent).toBe('Trip B');
  });

  it('a stale failure does not replace a newer success with an error', async () => {
    const first = deferred<ApiTrip[]>();
    api.getMyTrips.mockReturnValueOnce(first.promise).mockResolvedValueOnce([trip('B')]);
    const p1 = loadTrips();
    await vi.advanceTimersByTimeAsync(SLOW_TRIPS_MS);
    grid().querySelector<HTMLButtonElement>('#trips-slow-retry')!.click();
    await vi.advanceTimersByTimeAsync(0);
    first.reject(new Error('late failure'));
    await p1;
    expect(grid().querySelector('#trips-error')).toBeNull();
    expect(grid().querySelector('.trip-card-title')?.textContent).toBe('Trip B');
  });
});
