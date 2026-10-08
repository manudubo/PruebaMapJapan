// Create-trip double submit: a double click / Enter repeat used to create two trips because
// the submit handler awaited a dynamic import before disabling the button. Real dashboard.ts,
// mocked keycloak-js and API client; fresh module graph per test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const h = vi.hoisted(() => ({
  nextInit: [] as Array<() => Promise<boolean>>,
  inits: 0,
}));

vi.mock('keycloak-js', () => ({
  default: class FakeKeycloak {
    authenticated = false;
    token: string | undefined;
    tokenParsed: Record<string, unknown> | undefined;
    didInitialize = false;
    init = vi.fn(() => {
      if (this.didInitialize) throw new Error("A 'Keycloak' instance can only be initialized once.");
      this.didInitialize = true;
      h.inits++;
      const impl = h.nextInit.shift() ?? (() => new Promise<boolean>(() => {}));
      return impl().then((auth) => {
        this.authenticated = auth;
        this.token = auth ? 'tok' : undefined;
        this.tokenParsed = auth ? { sub: 'user-1', name: 'Test User' } : undefined;
        return auth;
      });
    });
    login = vi.fn(async () => {});
    isTokenExpired = vi.fn(() => false);
    updateToken = vi.fn(async () => true);
  },
}));

vi.mock('@/components/Navbar', () => ({}));
vi.mock('@/components/SearchBar', () => ({}));
vi.mock('@/modules/passkeyCampaign', () => ({
  checkPasskeyCampaign: vi.fn(),
  createPrefsStore: vi.fn(),
  runNewUserOnboarding: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getMyTrips: vi.fn(),
  createTrip: vi.fn(),
  updateMe: vi.fn(),
  EMAIL_NOT_VERIFIED_EVENT: 'travelmap:email-not-verified',
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string) { super(code); }
  },
  apiUrl: (p: string) => `http://localhost:8787/api${p}`,
}));
vi.mock('@/api/client', () => api);

const DASHBOARD_BODY = (() => {
  const html = readFileSync(resolve(__dirname, '..', 'dashboard.html'), 'utf8');
  return html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
})();

async function loadDashboard(): Promise<typeof import('@/pages/dashboard')> {
  vi.resetModules();
  return import('@/pages/dashboard');
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
  h.nextInit.length = 0;
  h.inits = 0;
  api.getMe.mockReset().mockResolvedValue({ id: 1, name: 'Test User', email: 't@e.st' });
  api.getMyTrips.mockReset().mockResolvedValue([]);
  api.createTrip.mockReset();
  document.body.innerHTML = DASHBOARD_BODY;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('create trip is idempotent', () => {
  // Real timers: the handler awaits a real dynamic import, which fake timers do not drive.
  beforeEach(() => { vi.useRealTimers(); });

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  async function signedInDashboard(): Promise<void> {
    h.nextInit.push(() => Promise.resolve(true));
    await loadDashboard();
    await vi.waitFor(() => expect(api.getMyTrips).toHaveBeenCalled());
    (document.getElementById('trip-name') as HTMLInputElement).value = 'Japan 2027';
  }

  /** Let the dynamic import('@/api/client') and every queued submit handler finish. */
  async function settle(): Promise<void> {
    await vi.waitFor(() => expect(api.createTrip).toHaveBeenCalled());
    await sleep(100);
  }

  const submit = (): void => {
    const form = document.getElementById('create-trip-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  };

  it('a double / triple submit in the same tick creates one trip', async () => {
    await signedInDashboard();
    api.createTrip.mockReturnValue(new Promise(() => {})); // in flight
    submit(); submit(); submit();
    await settle();
    expect(api.createTrip).toHaveBeenCalledTimes(1);
    const btn = document.querySelector<HTMLButtonElement>('#create-trip-form [type="submit"]')!;
    expect(btn.disabled).toBe(true);
  });

  it('submits spread over time while the first is in flight are ignored', async () => {
    await signedInDashboard();
    api.createTrip.mockReturnValue(new Promise(() => {}));
    submit();
    await settle();
    submit();
    await sleep(50);
    submit();
    await sleep(100);
    expect(api.createTrip).toHaveBeenCalledTimes(1);
  });

  it('after a failed save the form is usable again and a retry creates exactly one more', async () => {
    await signedInDashboard();
    api.createTrip.mockRejectedValueOnce(new Error('500'));
    submit(); submit();
    await settle();
    expect(api.createTrip).toHaveBeenCalledTimes(1);
    const btn = document.querySelector<HTMLButtonElement>('#create-trip-form [type="submit"]')!;
    expect(btn.disabled).toBe(false);
    expect(document.getElementById('create-trip-form')!.hasAttribute('aria-busy')).toBe(false);

    api.createTrip.mockReturnValue(new Promise(() => {}));
    submit(); submit();
    await settle();
    expect(api.createTrip).toHaveBeenCalledTimes(2);
  });
});
