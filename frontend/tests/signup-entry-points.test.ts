// "Sign up" next to every "Sign in": landing hero, navbar, dashboard prompt, signed-out trip
// view. Gated at build time (HTML) and at runtime (scripts); a failure to start shows a notice.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
    logout = vi.fn(async () => {});
    register = vi.fn(() => (h.registerImpl ? h.registerImpl() : new Promise<void>(() => {})));
    constructor() { h.instances.push(this as never); }
  },
}));

import * as auth from '@/auth/keycloak';
import { gateSignupHtml } from '../build/signupGatePlugin';
import { __resetRegistrationForTests, SIGNUP_PENDING_KEY } from '@/auth/registration';
import { __resetAuthUIForTests } from '@/auth/authStatusUI';

const ROOT = resolve(__dirname, '..');
const html = (page: string) => readFileSync(resolve(ROOT, page), 'utf8');
const latest = () => h.instances[h.instances.length - 1]!;
const BASE = (import.meta.env.BASE_URL as string).replace(/\/?$/, '/');

beforeEach(() => {
  h.instances.length = 0;
  h.nextInit.length = 0;
  h.registerImpl = null;
  window.sessionStorage.clear();
  auth.__resetAuthForTests();
  __resetRegistrationForTests();
  __resetAuthUIForTests();
  vi.stubEnv('VITE_KEYCLOAK_URL', 'https://kc.example');
  vi.stubEnv('VITE_REGISTRATION_ENABLED', '');
  window.history.replaceState(null, '', `${BASE}index.html`);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('static HTML entry points', () => {
  it.each([
    ['index.html', 'landing-signup-btn', 'landing-login-btn'],
    ['dashboard.html', 'auth-signup-prompt-btn', 'auth-login-prompt-btn'],
  ])('%s has a "Sign up" button (data-signup) right before "Sign in"', (page, signupId, loginId) => {
    document.body.innerHTML = html(page).replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, '');
    const signup = document.getElementById(signupId)!;
    const login = document.getElementById(loginId)!;
    expect(signup.textContent?.trim()).toBe('Sign up');
    expect(signup.hasAttribute('data-signup')).toBe(true);
    expect(signup.className).toMatch(/primary/);
    expect(login.textContent?.trim()).toBe('Sign in');
    expect(login.className).toMatch(/secondary/);
    expect(signup.nextElementSibling).toBe(login);
  });
});

describe('gateSignupHtml (build/signupGatePlugin.ts)', () => {
  const src = '<div><button id="a" class="x" type="button" data-signup>Sign up</button><a data-signup-x href="#">x</a></div>';

  it('leaves the HTML untouched when registration is on', () => {
    expect(gateSignupHtml(src, true)).toBe(src);
  });

  it('emits every data-signup element hidden when registration is off', () => {
    const out = gateSignupHtml(src, false);
    document.body.innerHTML = out;
    expect(document.getElementById('a')!.hidden).toBe(true);
    expect(document.querySelector('[data-signup-x]')!.hasAttribute('hidden')).toBe(false);
  });

  it('hides the real pages\' buttons', () => {
    for (const page of ['index.html', 'dashboard.html']) {
      document.body.innerHTML = gateSignupHtml(html(page), false).replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, '');
      const buttons = [...document.querySelectorAll<HTMLElement>('[data-signup]')];
      expect(buttons.length).toBeGreaterThan(0);
      expect(buttons.every((b) => b.hidden)).toBe(true);
    }
  });
});

describe('landing', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="main-content"><section id="landing-hero"><h1>x</h1>
        <button id="landing-signup-btn" type="button" data-signup>Sign up</button>
        <button id="landing-login-btn" type="button">Sign in</button></section></main>`;
  });

  it('Sign up starts registration once, even on a double click', async () => {
    const { initLanding } = await import('@/pages/landing');
    initLanding(vi.fn());
    const btn = document.getElementById('landing-signup-btn')!;
    btn.click();
    btn.click();
    await vi.waitFor(() => expect(latest().register).toHaveBeenCalledTimes(1));
    const { redirectUri } = latest().register.mock.calls[0]![0] as { redirectUri: string };
    expect(redirectUri).toMatch(/\/dashboard\.html$/);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });

  it('Keycloak cannot start the sign-up: friendly notice, button usable again', async () => {
    h.registerImpl = () => Promise.reject(new Error('down'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { initLanding } = await import('@/pages/landing');
    initLanding(vi.fn());
    const btn = document.getElementById('landing-signup-btn')!;
    btn.click();
    await vi.waitFor(() => expect(document.getElementById('signup-notice')).not.toBeNull());
    expect(document.getElementById('signup-notice')!.textContent).toMatch(/isn't available/);
    expect(btn.hasAttribute('aria-disabled')).toBe(false);
  });

  it('back from a sign-up without an account: the "wasn\'t completed" notice', async () => {
    window.sessionStorage.setItem(SIGNUP_PENDING_KEY, String(Date.now()));
    const { initLanding } = await import('@/pages/landing');
    initLanding(vi.fn());
    await vi.waitFor(() => expect(document.getElementById('signup-notice')).not.toBeNull());
    expect(document.getElementById('signup-notice')!.dataset['outcome']).toBe('incomplete');
  });

  it('registration off at runtime: the button is hidden and never starts anything', async () => {
    vi.stubEnv('VITE_REGISTRATION_ENABLED', 'false');
    const { initLanding } = await import('@/pages/landing');
    initLanding(vi.fn());
    const btn = document.getElementById('landing-signup-btn')!;
    expect(btn.hidden).toBe(true);
    btn.click();
    await Promise.resolve();
    expect(latest().register).not.toHaveBeenCalled();
  });
});

describe('navbar', () => {
  async function mountNav(): Promise<ShadowRoot> {
    await import('@/components/Navbar');
    document.body.innerHTML = '<main id="main-content"></main>';
    const nav = document.createElement('travel-nav');
    document.body.prepend(nav);
    await vi.waitFor(() => expect(auth.getAuthStatus()).toBe('anonymous'));
    await Promise.resolve();
    return nav.shadowRoot!;
  }

  it('signed out: Sign in (outlined) and Sign up (filled), both 44px targets', async () => {
    const root = await mountNav();
    const signin = root.querySelector<HTMLButtonElement>('.nav-auth-login')!;
    const signup = root.querySelector<HTMLButtonElement>('.nav-auth-signup')!;
    expect(signin.hidden).toBe(false);
    expect(signup.hidden).toBe(false);
    expect(signup.textContent).toBe('Sign up');
    expect(signup.classList.contains('nav-auth-primary')).toBe(true);
    expect(signin.classList.contains('nav-auth-outline')).toBe(true);
    expect(root.querySelector('style')!.textContent).toMatch(/\.nav-auth-btn\s*\{\s*min-height:\s*44px/);
    signup.click();
    await vi.waitFor(() => expect(latest().register).toHaveBeenCalledTimes(1));
  });

  it('registration off: no Sign up, Sign in stays the filled primary', async () => {
    vi.stubEnv('VITE_KEYCLOAK_URL', '');
    const root = await mountNav();
    expect(root.querySelector<HTMLButtonElement>('.nav-auth-signup')!.hidden).toBe(true);
    expect(root.querySelector('.nav-auth-login')!.classList.contains('nav-auth-primary')).toBe(true);
  });
});
