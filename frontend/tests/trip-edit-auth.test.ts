// Review S1: trip-edit must not treat a slow or down Keycloak as "signed out".
// Real trip-edit.ts + auth modules, mocked keycloak-js and API client; fresh module graph per test.
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

const sections = vi.hoisted(() => ({
  initMetadataSection: vi.fn(),
  initDestinationsSection: vi.fn(),
}));
vi.mock('@/pages/trip-edit/metadata', () => ({ initMetadataSection: sections.initMetadataSection }));
vi.mock('@/pages/trip-edit/destinations', () => ({ initDestinationsSection: sections.initDestinationsSection }));

const api = vi.hoisted(() => ({
  getTrip: vi.fn(),
  apiUrl: (p: string) => `http://localhost:8787/api${p}`,
}));
vi.mock('@/api/client', () => api);

const BODY = (() => {
  const html = readFileSync(resolve(__dirname, '..', 'trip-edit.html'), 'utf8');
  return html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
})();

let redirects: string[] = [];

async function loadPage(search = '?tripId=7'): Promise<void> {
  window.history.replaceState(null, '', `/PruebaMapJapan/trip-edit.html${search}`);
  vi.resetModules();
  const mod = await import('@/pages/trip-edit');
  mod.initTripEdit((url) => redirects.push(url));
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
  redirects = [];
  api.getTrip.mockReset().mockResolvedValue({ id: 7, name: 'Trip', destinations: [] });
  sections.initMetadataSection.mockReset();
  sections.initDestinationsSection.mockReset();
  document.body.innerHTML = BODY;
  document.body.className = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('trip-edit auth handling (S1)', () => {
  it('Keycloak slower than the init timeout: error state with Retry, no redirect, no API call', async () => {
    await loadPage();
    await vi.advanceTimersByTimeAsync(4000);

    expect(visible('auth-unavailable')).toBe(true);
    expect(document.getElementById('auth-unavailable-retry')).not.toBeNull();
    expect(document.body.classList.contains('ready')).toBe(true); // the state is visible, not opacity 0
    expect(redirects).toEqual([]);
    expect(api.getTrip).not.toHaveBeenCalled();
  });

  it('late success after the timeout loads the editor exactly once and clears the error', async () => {
    let resolveInit!: (v: boolean) => void;
    h.nextInit.push(() => new Promise<boolean>((r) => { resolveInit = r; }));
    await loadPage();
    await vi.advanceTimersByTimeAsync(4000);
    expect(visible('auth-unavailable')).toBe(true);

    resolveInit(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById('auth-unavailable')).toBeNull();
    expect(api.getTrip).toHaveBeenCalledTimes(1);
    expect(api.getTrip).toHaveBeenCalledWith('7');
    expect(sections.initMetadataSection).toHaveBeenCalledTimes(1);
    expect(visible('destinations-section')).toBe(true);
    expect(redirects).toEqual([]);
  });

  it('hard failure (Keycloak errors): error state, and Retry that succeeds loads the editor', async () => {
    h.nextInit.push(() => Promise.reject(new Error('500 from Keycloak')));
    await loadPage();
    await vi.advanceTimersByTimeAsync(0);
    expect(visible('auth-unavailable')).toBe(true);
    expect(redirects).toEqual([]);

    h.nextInit.push(() => Promise.resolve(true));
    (document.getElementById('auth-unavailable-retry') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById('auth-unavailable')).toBeNull();
    expect(api.getTrip).toHaveBeenCalledTimes(1);
    expect(h.inits).toBe(2);
  });

  it('genuinely signed out: redirects to the dashboard, no API call', async () => {
    h.nextInit.push(() => Promise.resolve(false));
    await loadPage();
    await vi.advanceTimersByTimeAsync(0);
    expect(redirects).toHaveLength(1);
    expect(redirects[0]).toMatch(/dashboard\.html$/);
    expect(api.getTrip).not.toHaveBeenCalled();
    expect(document.getElementById('auth-unavailable')).toBeNull();
  });

  it('signed in without a tripId: redirects to the dashboard', async () => {
    h.nextInit.push(() => Promise.resolve(true));
    await loadPage('');
    await vi.advanceTimersByTimeAsync(0);
    expect(redirects).toHaveLength(1);
    expect(redirects[0]).toMatch(/dashboard\.html$/);
    expect(api.getTrip).not.toHaveBeenCalled();
  });

  it('signed in: loads the trip once', async () => {
    h.nextInit.push(() => Promise.resolve(true));
    await loadPage();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getTrip).toHaveBeenCalledTimes(1);
    expect(sections.initDestinationsSection).toHaveBeenCalledWith(expect.anything(), '7');
    expect(document.body.classList.contains('ready')).toBe(true);
    expect(redirects).toEqual([]);
  });
});
