// Self-registration: feature gate, keycloak-js register() with a registered redirect URI
// (no query string), double-click guard, and what the app says when the user comes back
// from Keycloak without an account (cancelled, refused, Keycloak error page).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  instances: [] as Array<{ register: ReturnType<typeof vi.fn>; login: ReturnType<typeof vi.fn> }>,
  nextInit: [] as Array<() => Promise<boolean>>,
  registerImpl: null as null | (() => Promise<void>),
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
    register = vi.fn(() => (h.registerImpl ? h.registerImpl() : new Promise<void>(() => {})));
    updateToken = vi.fn(async () => true);
    constructor() { h.instances.push(this as never); }
  },
}));

import * as auth from '@/auth/keycloak';
import {
  registrationEnabled,
  signUp,
  wireSignUpButton,
  takeSignUpOutcome,
  SIGNUP_PENDING_KEY,
  SIGNUP_PENDING_TTL_MS,
  __resetRegistrationForTests,
} from '@/auth/registration';
import { showSignUpNotice, __resetAuthUIForTests } from '@/auth/authStatusUI';

const BASE = (import.meta.env.BASE_URL as string).replace(/\/?$/, '/');
const ORIGIN = window.location.origin;
const latest = () => h.instances[h.instances.length - 1]!;

function at(pathAndHash: string): void {
  window.history.replaceState(null, '', `${BASE}${pathAndHash}`);
}

beforeEach(() => {
  h.instances.length = 0;
  h.nextInit.length = 0;
  h.registerImpl = null;
  window.sessionStorage.clear();
  auth.__resetAuthForTests();
  __resetRegistrationForTests();
  __resetAuthUIForTests();
  document.body.innerHTML = '<main id="main-content"></main>';
  at('index.html');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('registrationEnabled', () => {
  it.each([
    [{ flag: undefined, keycloakUrl: 'https://kc.example' }, true],
    [{ flag: undefined, keycloakUrl: undefined }, false], // demo-only build: no Keycloak
    [{ flag: undefined, keycloakUrl: '  ' }, false],
    [{ flag: 'false', keycloakUrl: 'https://kc.example' }, false],
    [{ flag: 'FALSE', keycloakUrl: 'https://kc.example' }, false],
    [{ flag: '0', keycloakUrl: 'https://kc.example' }, false],
    [{ flag: 'true', keycloakUrl: undefined }, true],
    [{ flag: 'nonsense', keycloakUrl: 'https://kc.example' }, true],
  ])('%j -> %s', (env, expected) => {
    expect(registrationEnabled(env)).toBe(expected);
  });
});

describe('signUp', () => {
  it('calls keycloak-js register() with a registered redirect URI (no query string) and remembers the target', async () => {
    at('trip.html?tripId=12');
    void signUp(window.location.href);
    await Promise.resolve();
    const opts = latest().register.mock.calls[0]![0] as { redirectUri: string; scope: string };
    expect(opts.redirectUri).toBe(`${ORIGIN}${BASE}dashboard.html`);
    expect(new URL(opts.redirectUri).search).toBe('');
    expect(opts.scope).toContain('email');
    expect(JSON.parse(window.sessionStorage.getItem(auth.RETURN_TO_KEY)!).path).toBe(`${BASE}trip.html?tripId=12`);
    expect(window.sessionStorage.getItem(SIGNUP_PENDING_KEY)).not.toBeNull();
  });

  it('defaults to the dashboard, the page that runs the new-user onboarding', async () => {
    void signUp();
    await Promise.resolve();
    expect((latest().register.mock.calls[0]![0] as { redirectUri: string }).redirectUri)
      .toBe(`${ORIGIN}${BASE}dashboard.html`);
  });

  it('ignores a double click: register() runs once', async () => {
    const first = signUp();
    const second = await signUp();
    await Promise.resolve();
    expect(second).toBe(false);
    expect(latest().register).toHaveBeenCalledTimes(1);
    void first;
  });

  it('allows a new attempt after the page is restored from the back/forward cache', async () => {
    void signUp();
    await Promise.resolve();
    const ev = new Event('pageshow') as Event & { persisted?: boolean };
    Object.defineProperty(ev, 'persisted', { value: true });
    window.dispatchEvent(ev);
    void signUp();
    await Promise.resolve();
    expect(latest().register).toHaveBeenCalledTimes(2);
  });

  it('a register() failure rejects, clears the pending marker and re-arms the button', async () => {
    h.registerImpl = () => Promise.reject(new Error('adapter not ready'));
    await expect(signUp()).rejects.toThrow('adapter not ready');
    expect(window.sessionStorage.getItem(SIGNUP_PENDING_KEY)).toBeNull();
    h.registerImpl = null;
    void signUp();
    await Promise.resolve();
    expect(latest().register).toHaveBeenCalledTimes(2);
  });

  it('works when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    void signUp();
    await Promise.resolve();
    expect(latest().register).toHaveBeenCalledTimes(1);
    expect(takeSignUpOutcome(false)).toBe('none');
  });
});

describe('wireSignUpButton', () => {
  it('marks the button busy, ignores repeats, and reports a failure to start', async () => {
    const btn = document.createElement('button');
    document.body.append(btn);
    const onError = vi.fn();
    h.registerImpl = () => Promise.reject(new Error('down'));
    wireSignUpButton(btn, onError);
    wireSignUpButton(btn, onError); // wiring twice adds no second listener
    btn.click();
    btn.click();
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(btn.hasAttribute('aria-disabled')).toBe(false);
    expect(latest().register).toHaveBeenCalledTimes(1);
  });
});

describe('takeSignUpOutcome', () => {
  const pending = (at: number) => window.sessionStorage.setItem(SIGNUP_PENDING_KEY, String(at));

  it("'none' without a sign-up in flight", () => {
    expect(takeSignUpOutcome(false)).toBe('none');
    expect(takeSignUpOutcome(true)).toBe('none');
  });

  it("'completed' when signed in; the marker is consumed", () => {
    pending(Date.now());
    expect(takeSignUpOutcome(true)).toBe('completed');
    expect(takeSignUpOutcome(true)).toBe('none');
  });

  it("'incomplete' when back without an answer (Keycloak error page, Back button)", () => {
    pending(Date.now());
    expect(takeSignUpOutcome(false)).toBe('incomplete');
  });

  it("'none' for a stale or future marker", () => {
    pending(Date.now() - SIGNUP_PENDING_TTL_MS - 1);
    expect(takeSignUpOutcome(false)).toBe('none');
    pending(Date.now() + 10 * 60_000);
    expect(takeSignUpOutcome(false)).toBe('none');
    window.sessionStorage.setItem(SIGNUP_PENDING_KEY, 'garbage');
    expect(takeSignUpOutcome(false)).toBe('none');
  });

  it("'cancelled' / 'refused' from Keycloak's error callback; the user is anonymous, not 'unavailable'", async () => {
    pending(Date.now());
    at('dashboard.html#error=access_denied&state=abc');
    h.nextInit.push(() => Promise.reject({ error: 'access_denied' }));
    await expect(auth.initKeycloak()).resolves.toBe(false);
    expect(auth.getAuthStatus()).toBe('anonymous');
    expect(takeSignUpOutcome(false)).toBe('cancelled');

    auth.__resetAuthForTests();
    pending(Date.now());
    at('dashboard.html#error=temporarily_unavailable&error_description=x&state=abc');
    h.nextInit.push(() => Promise.reject({ error: 'temporarily_unavailable' }));
    await expect(auth.initKeycloak()).resolves.toBe(false);
    expect(auth.getAuthStatus()).toBe('anonymous');
    expect(takeSignUpOutcome(false)).toBe('refused');
  });

  it('a callback error drops the remembered return target', async () => {
    window.sessionStorage.setItem(auth.RETURN_TO_KEY, JSON.stringify({ path: `${BASE}trip.html?tripId=1`, at: Date.now() }));
    at('dashboard.html#error=access_denied&state=abc');
    h.nextInit.push(() => Promise.reject({ error: 'access_denied' }));
    await auth.initKeycloak();
    expect(window.sessionStorage.getItem(auth.RETURN_TO_KEY)).toBeNull();
  });

  it('an init failure without a callback is still "unavailable" (Keycloak down)', async () => {
    h.nextInit.push(() => Promise.reject(new Error('network')));
    await expect(auth.initKeycloak()).rejects.toThrow();
    expect(auth.getAuthStatus()).toBe('unavailable');
  });
});

describe('showSignUpNotice', () => {
  it.each([
    ['cancelled', /cancelled/],
    ['refused', /isn't available/],
    ['incomplete', /wasn't completed/],
    ['unavailable', /isn't available/],
  ] as const)('%s: a dismissible status notice', (outcome, text) => {
    const notice = showSignUpNotice(outcome)!;
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toMatch(text);
    expect(document.querySelectorAll('#signup-notice')).toHaveLength(1);
    showSignUpNotice(outcome); // replaces, never stacks
    expect(document.querySelectorAll('#signup-notice')).toHaveLength(1);
    (document.querySelector('#signup-notice .auth-notice-dismiss') as HTMLButtonElement).click();
    expect(document.getElementById('signup-notice')).toBeNull();
  });

  it('nothing for none/completed', () => {
    expect(showSignUpNotice('none')).toBeNull();
    expect(showSignUpNotice('completed')).toBeNull();
    expect(document.getElementById('signup-notice')).toBeNull();
  });
});
