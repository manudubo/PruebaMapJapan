// Sign-in from a page with a query string (PROD-HARDENING "also found"): Keycloak only
// accepts the exact redirect URIs registered in terraform/keycloak (no query, no wildcard),
// so `redirect_uri=…/trip-edit.html?tripId=12` got 400 "Invalid redirect_uri". The app
// must send a registered page and bring the user back to the real target after login.
// keycloak-js is mocked; each instance records its login() options.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const h = vi.hoisted(() => ({
  instances: [] as Array<{ login: ReturnType<typeof vi.fn>; logout: ReturnType<typeof vi.fn> }>,
  nextInit: [] as Array<() => Promise<boolean>>,
}));

vi.mock('keycloak-js', () => ({
  default: class FakeKeycloak {
    authenticated = false;
    token: string | undefined;
    init = vi.fn(() => {
      const impl = h.nextInit.shift() ?? (() => Promise.resolve(false));
      return impl().then((auth) => {
        this.authenticated = auth;
        this.token = auth ? 'tok' : undefined;
        return auth;
      });
    });
    login = vi.fn(async () => {});
    logout = vi.fn(async () => {});
    constructor() { h.instances.push(this as never); }
  },
}));

import * as auth from '@/auth/keycloak';

const BASE = (import.meta.env.BASE_URL as string).replace(/\/?$/, '/');
const ORIGIN = window.location.origin;
const page = (p: string) => `${ORIGIN}${BASE}${p}`;
const stored = () => window.sessionStorage.getItem(auth.RETURN_TO_KEY);
let navigations: string[];

function at(pathAndQuery: string): void {
  window.history.replaceState(null, '', `${BASE}${pathAndQuery}`);
}

beforeEach(() => {
  h.instances.length = 0;
  h.nextInit.length = 0;
  window.sessionStorage.clear();
  navigations = [];
  auth.__resetAuthForTests();
  auth.__setNavigateForTests((url) => navigations.push(url));
  at('index.html');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('loginRedirectUri: only registered pages go to Keycloak', () => {
  it('trip-edit.html?tripId=12 → dashboard.html, the real target is remembered', () => {
    expect(auth.loginRedirectUri(page('trip-edit.html?tripId=12'))).toBe(page('dashboard.html'));
    expect(JSON.parse(stored()!)).toMatchObject({ path: `${BASE}trip-edit.html?tripId=12` });
  });

  it('a registered page without query or hash is sent as is and nothing is remembered', () => {
    window.sessionStorage.setItem(auth.RETURN_TO_KEY, JSON.stringify({ path: `${BASE}trip.html`, at: Date.now() }));
    for (const p of auth.LOGIN_REDIRECT_PAGES) {
      expect(auth.loginRedirectUri(page(p))).toBe(page(p));
    }
    expect(stored()).toBeNull(); // a stale target from an abandoned login is dropped
  });

  it('a registered page with a query or a hash lands on that page and comes back with it', () => {
    expect(auth.loginRedirectUri(page('profile.html?tab=passkeys#list'))).toBe(page('profile.html'));
    expect(JSON.parse(stored()!).path).toBe(`${BASE}profile.html?tab=passkeys#list`);
  });

  it('the app root maps to index.html', () => {
    expect(auth.loginRedirectUri(`${ORIGIN}${BASE}`)).toBe(page('index.html'));
    expect(stored()).toBeNull();
  });

  it.each([
    ['another origin', 'https://evil.example/PruebaMapJapan/trip.html?tripId=1'],
    ['a protocol-relative URL', '//evil.example/x'],
    ['a path outside the app', `${ORIGIN}/elsewhere/page.html?x=1`],
  ])('%s is never remembered (no open redirect): dashboard, nothing stored', (_l, target) => {
    if (BASE === '/' && _l === 'a path outside the app') return; // every path is inside a root app
    expect(auth.loginRedirectUri(target)).toBe(page('dashboard.html'));
    expect(stored()).toBeNull();
  });

  it('still answers a registered URI when sessionStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(auth.loginRedirectUri(page('trip-edit.html?tripId=3'))).toBe(page('dashboard.html'));
  });

  it('matches the redirect URIs Terraform registers (terraform/keycloak/main.tf)', () => {
    const tf = readFileSync(resolve(__dirname, '../../terraform/keycloak/main.tf'), 'utf8');
    const m = tf.match(/redirect_pages\s*=\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const pages = [...m![1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]).filter((p) => p !== 'silent-check-sso.html');
    expect([...auth.LOGIN_REDIRECT_PAGES].sort()).toEqual(pages.sort());
  });
});

describe('login(): the authorize request carries a registered redirect_uri', () => {
  it('from trip-edit.html?tripId=12 the redirect_uri has no query string', async () => {
    at('trip-edit.html?tripId=12');
    await auth.login();
    const opts = h.instances.at(-1)!.login.mock.calls[0]![0] as { redirectUri: string };
    expect(opts.redirectUri).toBe(page('dashboard.html'));
    expect(opts.redirectUri).not.toMatch(/[?#]/);
    expect(JSON.parse(stored()!).path).toBe(`${BASE}trip-edit.html?tripId=12`);
  });

  it('an explicit target is honoured the same way', async () => {
    await auth.login(page('trip.html?tripId=9&dest=1'));
    const opts = h.instances.at(-1)!.login.mock.calls[0]![0] as { redirectUri: string };
    expect(opts.redirectUri).toBe(page('dashboard.html'));
    expect(JSON.parse(stored()!).path).toBe(`${BASE}trip.html?tripId=9&dest=1`);
  });

  it('logout() defaults to the registered post-logout page, not the bare origin', async () => {
    await auth.logout();
    expect(h.instances.at(-1)!.logout).toHaveBeenCalledWith({ redirectUri: page('index.html') });
  });
});

describe('after the Keycloak callback the user is sent back to the remembered target', () => {
  function remember(path: string, at = Date.now()): void {
    window.sessionStorage.setItem(auth.RETURN_TO_KEY, JSON.stringify({ path, at }));
  }

  it('authenticated callback on the landing page → original page and query, entry consumed', async () => {
    remember(`${BASE}trip-edit.html?tripId=12`);
    at('dashboard.html#state=abc&session_state=s&code=c');
    h.nextInit.push(() => Promise.resolve(true));
    await auth.initKeycloak();
    expect(navigations).toEqual([page('trip-edit.html?tripId=12')]);
    expect(stored()).toBeNull();
  });

  it('no callback in the URL (plain visit, SSO cookie) → stay, entry kept for the pending login', async () => {
    remember(`${BASE}trip-edit.html?tripId=12`);
    at('dashboard.html');
    h.nextInit.push(() => Promise.resolve(true));
    await auth.initKeycloak();
    expect(navigations).toEqual([]);
  });

  it('a failed or cancelled login (error callback) drops the entry and stays', async () => {
    remember(`${BASE}trip-edit.html?tripId=12`);
    at('dashboard.html#error=access_denied&state=abc');
    h.nextInit.push(() => Promise.resolve(false));
    await auth.initKeycloak();
    expect(navigations).toEqual([]);
    expect(stored()).toBeNull();
  });

  it('an entry older than the login window is ignored', async () => {
    remember(`${BASE}trip-edit.html?tripId=12`, Date.now() - auth.RETURN_TO_TTL_MS - 1);
    at('dashboard.html#state=abc&code=c');
    h.nextInit.push(() => Promise.resolve(true));
    await auth.initKeycloak();
    expect(navigations).toEqual([]);
    expect(stored()).toBeNull();
  });

  it.each([
    ['absolute foreign URL', 'https://evil.example/x'],
    ['protocol-relative', '//evil.example/x'],
    ['backslash trick', '/\\evil.example/x'],
    ['javascript:', 'javascript:alert(1)'],
    ['not JSON', '{oops'],
  ])('a tampered entry (%s) is ignored', async (_l, path) => {
    window.sessionStorage.setItem(auth.RETURN_TO_KEY, _l === 'not JSON' ? path : JSON.stringify({ path, at: Date.now() }));
    at('dashboard.html#state=abc&code=c');
    h.nextInit.push(() => Promise.resolve(true));
    await auth.initKeycloak();
    expect(navigations).toEqual([]);
    expect(stored()).toBeNull();
  });

  it('already on the target (registered page + hash) → no extra navigation', async () => {
    remember(`${BASE}dashboard.html`);
    at('dashboard.html#state=abc&code=c');
    h.nextInit.push(() => Promise.resolve(true));
    await auth.initKeycloak();
    expect(navigations).toEqual([]);
  });
});

describe('every Keycloak redirect in the app goes through loginRedirectUri', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return sources(p);
      return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
    });
  }

  it('no source passes window.location.href (or origin) as a Keycloak redirectUri', () => {
    const offenders = sources(resolve(__dirname, '../src')).filter((f) =>
      /redirectUri\s*:\s*window\.location\.(href|origin)/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

describe('Home link vs. post-login redirect', () => {
  it('login from the landing still targets the registered, query-free index page', () => {
    expect(auth.loginRedirectUri(page('index.html'))).toBe(page('index.html'));
    // index.html?home is not registered with a query: registered page + remembered target.
    expect(auth.loginRedirectUri(page('index.html?home'))).toBe(page('index.html'));
    expect(stored()).not.toBeNull();
  });
});
