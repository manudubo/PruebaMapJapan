// QA follow-up (findings 3 + 4): shared "sign-in service unavailable" UI, i18n strings, the
// landing page wiring and the dashboard states. Real auth module, mocked keycloak-js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  nextInit: [] as Array<() => Promise<boolean>>,
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

import * as auth from '@/auth/keycloak';
import { authLocale, authText, AUTH_LOCALES, type AuthMessageKey } from '@/auth/authMessages';
import * as ui from '@/auth/authStatusUI';

function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
}

function setLanguages(langs: string[]): void {
  Object.defineProperty(window.navigator, 'languages', { configurable: true, get: () => langs });
}

beforeEach(() => {
  vi.useFakeTimers();
  setOnline(true);
  setLanguages(['en-US']);
  h.nextInit.length = 0;
  auth.__resetAuthForTests();
  ui.__resetAuthUIForTests();
  document.body.innerHTML = '<main id="main-content"><div class="page-card" id="content"><h1>My Trips</h1></div></main>';
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

describe('authMessages', () => {
  const keys: AuthMessageKey[] = [
    'unavailableTitle', 'unavailableBody', 'offlineBody', 'stillUnavailable', 'retry',
    'retrying', 'home', 'checking', 'notice', 'dismiss',
  ];

  it('supports English and Spanish', () => {
    expect(AUTH_LOCALES.sort()).toEqual(['en', 'es']);
  });

  it.each(keys)('%s is translated in both languages', (key) => {
    expect(authText(key, 'en').length).toBeGreaterThan(0);
    expect(authText(key, 'es').length).toBeGreaterThan(0);
    if (key !== 'dismiss') expect(authText(key, 'es')).not.toBe(authText(key, 'en'));
  });

  it('picks the first supported browser language, English otherwise', () => {
    expect(authLocale(['es-AR', 'en'])).toBe('es');
    expect(authLocale(['fr-FR', 'en-GB'])).toBe('en');
    expect(authLocale(['de'])).toBe('en');
    expect(authLocale([])).toBe('en');
  });
});

// ---------------------------------------------------------------------------
// Full-page state
// ---------------------------------------------------------------------------

describe('showAuthUnavailableState', () => {
  it('renders an accessible error state and hides (not removes) the page', () => {
    ui.showAuthUnavailableState();
    const section = document.getElementById('auth-unavailable')!;
    expect(section).not.toBeNull();
    expect(section.lang).toBe('en');
    expect(section.getAttribute('aria-labelledby')).toBe('auth-unavailable-title');
    expect(section.querySelector('[role="alert"] h1')?.textContent).toBe("Can't reach the sign-in service");
    const retry = section.querySelector('button')!;
    expect(retry.textContent).toBe('Retry');
    expect(retry.type).toBe('button');
    const home = section.querySelector('a')!;
    expect(home.getAttribute('href')).toMatch(/index\.html$/);
    expect(section.querySelector('[role="status"]')).not.toBeNull();

    const content = document.getElementById('content')!;
    expect(content.hidden).toBe(true);
    // Only one visible h1 on the page.
    const visibleH1 = [...document.querySelectorAll('h1')].filter((x) => !x.closest('[hidden]'));
    expect(visibleH1).toHaveLength(1);
  });

  it('is idempotent and restores the page on clear', () => {
    ui.showAuthUnavailableState();
    ui.showAuthUnavailableState();
    expect(document.querySelectorAll('#auth-unavailable')).toHaveLength(1);
    ui.clearAuthUnavailableState();
    expect(document.getElementById('auth-unavailable')).toBeNull();
    expect(document.getElementById('content')!.hidden).toBe(false);
  });

  it('does not unhide elements that were already hidden by the page', () => {
    const prompt = document.createElement('div');
    prompt.hidden = true;
    document.getElementById('main-content')!.append(prompt);
    ui.showAuthUnavailableState();
    ui.clearAuthUnavailableState();
    expect(prompt.hidden).toBe(true);
  });

  it('uses Spanish for Spanish browsers', () => {
    setLanguages(['es-AR']);
    ui.showAuthUnavailableState();
    const section = document.getElementById('auth-unavailable')!;
    expect(section.lang).toBe('es');
    expect(section.querySelector('h1')?.textContent).toBe(authText('unavailableTitle', 'es'));
    expect(section.querySelector('button')?.textContent).toBe('Reintentar');
  });

  it('explains offline separately', async () => {
    setOnline(false);
    await auth.initKeycloak().catch(() => {});
    ui.showAuthUnavailableState();
    expect(document.querySelector('.auth-unavailable-body')?.textContent).toBe(authText('offlineBody', 'en'));
  });

  it('Retry: rapid clicks start one attempt; failure re-enables and announces', async () => {
    h.nextInit.push(() => Promise.reject(new Error('down')));
    await auth.initKeycloak().catch(() => {});
    ui.showAuthUnavailableState();
    const btn = document.getElementById('auth-unavailable-retry') as HTMLButtonElement;

    h.nextInit.push(() => Promise.reject(new Error('still down')));
    btn.click(); btn.click(); btn.click();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.textContent).toBe('Retrying…');
    await vi.advanceTimersByTimeAsync(0);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Retry');
    expect(document.querySelector('.auth-unavailable-status')?.textContent).toBe('Still no response from the sign-in service.');
    expect(auth.getAuthStatus()).toBe('unavailable');
  });

  it('Retry that hangs is bounded: button comes back after the timeout', async () => {
    h.nextInit.push(() => Promise.reject(new Error('down')));
    await auth.initKeycloak().catch(() => {});
    ui.showAuthUnavailableState();
    const btn = document.getElementById('auth-unavailable-retry') as HTMLButtonElement;
    btn.click(); // next init hangs forever
    await vi.advanceTimersByTimeAsync(auth.AUTH_INIT_TIMEOUT_MS);
    expect(btn.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Notice
// ---------------------------------------------------------------------------

describe('showAuthNotice', () => {
  it('is a non-blocking status with Retry and a labelled Dismiss', () => {
    ui.showAuthNotice();
    const notice = document.getElementById('auth-notice')!;
    expect(notice.getAttribute('role')).toBe('status');
    expect(document.getElementById('content')!.hidden).toBe(false); // page untouched
    expect(notice.querySelector('.auth-notice-retry')?.textContent).toBe('Retry');
    const dismiss = notice.querySelector('.auth-notice-dismiss') as HTMLButtonElement;
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss');
    dismiss.click();
    expect(document.getElementById('auth-notice')).toBeNull();
    ui.showAuthNotice();
    expect(document.getElementById('auth-notice')).toBeNull(); // stays dismissed
  });

  it('never duplicates', () => {
    ui.showAuthNotice();
    ui.showAuthNotice();
    expect(document.querySelectorAll('#auth-notice')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// watchAuth
// ---------------------------------------------------------------------------

describe('watchAuth', () => {
  it('routes timeout then late success, once each', async () => {
    let resolve!: (v: boolean) => void;
    h.nextInit.push(() => new Promise<boolean>((r) => { resolve = r; }));
    const handlers = { unavailable: vi.fn(), authenticated: vi.fn(), anonymous: vi.fn() };
    ui.watchAuth(handlers);
    await vi.advanceTimersByTimeAsync(auth.AUTH_INIT_TIMEOUT_MS);
    expect(handlers.unavailable).toHaveBeenCalledTimes(1);
    resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(handlers.authenticated).toHaveBeenCalledTimes(1);
    expect(handlers.anonymous).not.toHaveBeenCalled();
  });

  it('joins an auth check that already finished', async () => {
    h.nextInit.push(() => Promise.resolve(false));
    await auth.initKeycloak();
    const anonymous = vi.fn();
    ui.watchAuth({ anonymous });
    await vi.advanceTimersByTimeAsync(0);
    expect(anonymous).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------------

describe('landing', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="main-content">
        <section class="landing-hero" id="landing-hero"><h1>Your next trip</h1>
          <button id="landing-login-btn" type="button">Sign in</button></section>
      </main>`;
  });

  it('never hides the hero and shows the notice once Keycloak times out', async () => {
    const { initLanding } = await import('@/pages/landing');
    const navigate = vi.fn();
    initLanding(navigate);
    const hero = document.getElementById('landing-hero')!;
    expect(hero.hidden || hero.classList.contains('is-hidden')).toBe(false);
    expect(document.getElementById('landing-loading')).toBeNull();
    await vi.advanceTimersByTimeAsync(auth.AUTH_INIT_TIMEOUT_MS);
    expect(document.getElementById('auth-notice')).not.toBeNull();
    expect(hero.hidden).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('late success redirects to the dashboard (exactly once)', async () => {
    let resolve!: (v: boolean) => void;
    h.nextInit.push(() => new Promise<boolean>((r) => { resolve = r; }));
    const { initLanding } = await import('@/pages/landing');
    const navigate = vi.fn();
    initLanding(navigate);
    await vi.advanceTimersByTimeAsync(auth.AUTH_INIT_TIMEOUT_MS + 2000);
    resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]![0]).toMatch(/dashboard\.html$/);
    expect(document.getElementById('auth-notice')).toBeNull();
  });

  it('signed out: no notice, no redirect', async () => {
    h.nextInit.push(() => Promise.resolve(false));
    const { initLanding } = await import('@/pages/landing');
    const navigate = vi.fn();
    initLanding(navigate);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById('auth-notice')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
