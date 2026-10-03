// QA follow-up (finding 4): dashboard states when Keycloak is slow, down or recovers.
// Real dashboard.ts + auth modules, mocked keycloak-js and API client; fresh module graph per test.
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
vi.mock('@/modules/passkeyCampaign', () => ({ checkPasskeyCampaign: vi.fn() }));

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getMyTrips: vi.fn(),
  createTrip: vi.fn(),
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

const visible = (id: string): boolean => {
  const node = document.getElementById(id);
  return !!node && !node.closest('[hidden]');
};

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

describe('dashboard with Keycloak unreachable', () => {
  it('shows a bounded "checking" status, then an error state distinct from the sign-in prompt', async () => {
    await loadDashboard();
    expect(document.getElementById('auth-pending')?.getAttribute('role')).toBe('status');

    await vi.advanceTimersByTimeAsync(3999);
    expect(document.getElementById('auth-unavailable')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    expect(document.getElementById('auth-pending')).toBeNull(); // no endless "checking"
    expect(visible('auth-unavailable')).toBe(true);
    expect(document.querySelector('#auth-unavailable h1')?.textContent).toBe("Can't reach the sign-in service");
    expect(document.querySelector('#auth-unavailable [role="alert"]')).not.toBeNull();
    expect(visible('dashboard-login-prompt')).toBe(false);
    expect(visible('dashboard-greeting')).toBe(false); // single visible h1
    expect(visible('trips-grid')).toBe(false);
    expect(api.getMyTrips).not.toHaveBeenCalled();
  });

  it('Keycloak answering with an error (500/HTML) lands in the same state immediately', async () => {
    h.nextInit.push(() => Promise.reject(new Error('Timeout when waiting for 3rd party check iframe message.')));
    await loadDashboard();
    await vi.advanceTimersByTimeAsync(0);
    expect(visible('auth-unavailable')).toBe(true);
  });

  it('Retry that finds the user signed out shows the sign-in prompt instead', async () => {
    h.nextInit.push(() => Promise.reject(new Error('down')));
    await loadDashboard();
    await vi.advanceTimersByTimeAsync(0);
    h.nextInit.push(() => Promise.resolve(false));
    (document.getElementById('auth-unavailable-retry') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);

    expect(document.getElementById('auth-unavailable')).toBeNull();
    expect(visible('dashboard-login-prompt')).toBe(true);
    expect(visible('dashboard-greeting')).toBe(true);
    expect(h.inits).toBe(2);
  });

  it('late success after the timeout loads trips once and restores the page', async () => {
    let resolveInit!: (v: boolean) => void;
    h.nextInit.push(() => new Promise<boolean>((r) => { resolveInit = r; }));
    await loadDashboard();
    await vi.advanceTimersByTimeAsync(4000);
    expect(visible('auth-unavailable')).toBe(true);

    resolveInit(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById('auth-unavailable')).toBeNull();
    expect(visible('dashboard-greeting')).toBe(true);
    expect(visible('trips-grid')).toBe(true);
    expect(visible('new-trip-btn')).toBe(true);
    expect(api.getMyTrips).toHaveBeenCalledTimes(1);
    expect(h.inits).toBe(1);
  });

  it('rapid Retry clicks while the first attempt is still slow: one extra attempt, first answer wins, trips load once', async () => {
    let resolveInit!: (v: boolean) => void;
    h.nextInit.push(() => new Promise<boolean>((r) => { resolveInit = r; }));
    await loadDashboard();
    await vi.advanceTimersByTimeAsync(4000);
    const retry = document.getElementById('auth-unavailable-retry') as HTMLButtonElement;
    for (let i = 0; i < 5; i++) retry.click();
    resolveInit(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.inits).toBe(2);
    expect(visible('auth-unavailable')).toBe(false);
    expect(api.getMyTrips).toHaveBeenCalledTimes(1);
  });
});
