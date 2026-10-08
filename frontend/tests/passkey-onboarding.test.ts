// New-user passkey onboarding (src/modules/passkeyCampaign.ts): capability detection, throttling
// and persistence, orchestration rules, and the dialog's accessibility behavior.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  login: vi.fn(async () => {}),
  getToken: vi.fn(async () => 'tok'),
  toast: vi.fn(),
}));

vi.mock('@/auth/keycloak', () => ({
  keycloak: { login: h.login },
  loginRedirectUri: () => 'https://app.test/PruebaMapJapan/dashboard.html',
  getToken: h.getToken,
  keycloakBaseUrl: (raw: string | undefined) => raw ?? 'http://kc.test',
  KEYCLOAK_REALM: 'japan-trip',
}));
vi.mock('@/modules/toast', () => ({ showToast: h.toast }));

import {
  parsePrefs,
  mergePrefs,
  isThrottled,
  createPrefsStore,
  detectPasskeySupport,
  countCredentials,
  runNewUserOnboarding,
  showOnboardingDialog,
  SNOOZE_MS,
  MAX_SHOWS,
  LOCAL_KEY_PREFIX,
  PREFS_FIELD,
  DIALOG_ID,
  type CampaignPrefs,
  type PrefsStore,
  type OnboardingDialogOptions,
  type OnboardingChoice,
} from '@/modules/passkeyCampaign';

const NOW = 1_800_000_000_000;
const fresh: CampaignPrefs = { never: false, snoozeUntil: 0, shown: 0 };

function setPKC(value: unknown): void {
  Object.defineProperty(window, 'PublicKeyCredential', { value, configurable: true, writable: true });
}

function memoryStore(initial: CampaignPrefs = fresh): PrefsStore & { saved: CampaignPrefs[] } {
  let cur = initial;
  const saved: CampaignPrefs[] = [];
  return {
    saved,
    load: () => cur,
    async save(next) {
      cur = mergePrefs(cur, next);
      saved.push(next);
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '<main id="m"><button id="opener">open</button></main>';
  window.localStorage.clear();
  h.login.mockClear();
  h.toast.mockClear();
  setPKC(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('campaign prefs', () => {
  it('parses leniently', () => {
    expect(parsePrefs(undefined)).toEqual(fresh);
    expect(parsePrefs('not json')).toEqual(fresh);
    expect(parsePrefs(42)).toEqual(fresh);
    expect(parsePrefs({ never: 'yes', snoozeUntil: -1, shown: 'x' })).toEqual(fresh);
    expect(parsePrefs('{"never":true,"snoozeUntil":5,"shown":2.7}')).toEqual({ never: true, snoozeUntil: 5, shown: 2 });
  });

  it('merges to the more restrictive copy', () => {
    expect(mergePrefs({ never: false, snoozeUntil: 5, shown: 1 }, { never: true, snoozeUntil: 3, shown: 2 })).toEqual({
      never: true, snoozeUntil: 5, shown: 2,
    });
  });

  it('throttles on never, snooze and the show cap', () => {
    expect(isThrottled(fresh, NOW)).toBe(false);
    expect(isThrottled({ ...fresh, never: true }, NOW)).toBe(true);
    expect(isThrottled({ ...fresh, snoozeUntil: NOW + 1 }, NOW)).toBe(true);
    expect(isThrottled({ ...fresh, snoozeUntil: NOW - 1 }, NOW)).toBe(false);
    expect(isThrottled({ ...fresh, shown: MAX_SHOWS }, NOW)).toBe(true);
  });
});

describe('prefs store', () => {
  it('writes the account preferences (keeping other keys) and a local copy', async () => {
    const patch = vi.fn(async () => ({}));
    const store = createPrefsStore('u1', { theme: 'dark' }, patch);
    await store.save({ never: true, snoozeUntil: 9, shown: 1 });
    expect(patch).toHaveBeenCalledWith({ theme: 'dark', [PREFS_FIELD]: { never: true, snoozeUntil: 9, shown: 1 } });
    expect(JSON.parse(window.localStorage.getItem(LOCAL_KEY_PREFIX + 'u1')!)).toMatchObject({ never: true });
  });

  it('reads the account copy (another device) and the local copy', () => {
    const store = createPrefsStore('u1', { [PREFS_FIELD]: { never: true } }, vi.fn());
    expect(store.load().never).toBe(true);
    window.localStorage.setItem(LOCAL_KEY_PREFIX + 'u2', JSON.stringify({ snoozeUntil: 77 }));
    expect(createPrefsStore('u2', null, vi.fn()).load().snoozeUntil).toBe(77);
  });

  it('still throttles when the API call fails (local copy)', async () => {
    const store = createPrefsStore('u1', null, async () => { throw new Error('offline'); });
    await expect(store.save({ never: true, snoozeUntil: 0, shown: 1 })).resolves.toBeUndefined();
    expect(createPrefsStore('u1', null, vi.fn()).load().never).toBe(true);
  });

  it('still throttles through the API when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const patch = vi.fn(async () => ({}));
    const store = createPrefsStore('u1', null, patch);
    await store.save({ never: true, snoozeUntil: 0, shown: 1 });
    expect(patch).toHaveBeenCalled();
    expect(store.load().never).toBe(true);
  });

  it('different users do not share the local copy', async () => {
    await createPrefsStore('a', null, vi.fn()).save({ never: true, snoozeUntil: 0, shown: 1 });
    expect(createPrefsStore('b', null, vi.fn()).load().never).toBe(false);
  });
});

describe('detectPasskeySupport', () => {
  it('false without PublicKeyCredential (removed by privacy tools / old browsers)', async () => {
    expect(await detectPasskeySupport()).toBe(false);
  });
  it('true for security-key-only browsers (no platform check available)', async () => {
    setPKC(class {});
    expect(await detectPasskeySupport()).toBe(true);
  });
  it('follows isUserVerifyingPlatformAuthenticatorAvailable', async () => {
    setPKC({ isUserVerifyingPlatformAuthenticatorAvailable: async () => true });
    expect(await detectPasskeySupport()).toBe(true);
    setPKC({ isUserVerifyingPlatformAuthenticatorAvailable: async () => false });
    expect(await detectPasskeySupport()).toBe(false);
  });
  it('false when the check throws or rejects', async () => {
    setPKC({ isUserVerifyingPlatformAuthenticatorAvailable: () => { throw new Error('nope'); } });
    expect(await detectPasskeySupport()).toBe(false);
    setPKC({ isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.reject(new Error('nope')) });
    expect(await detectPasskeySupport()).toBe(false);
  });
});

describe('countCredentials', () => {
  const reply = (status: number, body: unknown) => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  };
  it('counts the credentials of the asked type', async () => {
    reply(200, [{ type: 'webauthn-passwordless', userCredentialMetadatas: [{}, {}] }]);
    expect(await countCredentials('webauthn-passwordless')).toBe(2);
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toContain('/realms/japan-trip/account/credentials?type=webauthn-passwordless');
  });
  it('zero when the type is absent', async () => {
    reply(200, []);
    expect(await countCredentials('password')).toBe(0);
  });
  it('null (unknown) on HTTP errors, network errors and token errors', async () => {
    reply(403, {});
    expect(await countCredentials('password')).toBeNull();
    global.fetch = vi.fn(async () => { throw new TypeError('x'); }) as typeof fetch;
    expect(await countCredentials('password')).toBeNull();
    h.getToken.mockRejectedValueOnce(new Error('expired'));
    expect(await countCredentials('password')).toBeNull();
  });
});

describe('runNewUserOnboarding', () => {
  const base = () => ({
    isNew: true,
    userKey: 'u1',
    now: () => NOW,
    supported: async () => true,
    countCredentials: vi.fn(async () => 0),
    show: vi.fn(async (_o: OnboardingDialogOptions): Promise<OnboardingChoice> => 'later'),
  });

  it('does nothing for existing users', async () => {
    const ctx = base();
    expect(await runNewUserOnboarding({ ...ctx, isNew: false, store: memoryStore() })).toBe('not-new');
    expect(ctx.show).not.toHaveBeenCalled();
  });

  it('offers a passkey to a new user on a capable device, and records the impression first', async () => {
    const ctx = base();
    const store = memoryStore();
    ctx.show.mockImplementation(async () => {
      expect(store.saved).toEqual([{ never: false, snoozeUntil: NOW + SNOOZE_MS, shown: 1 }]);
      return 'later';
    });
    expect(await runNewUserOnboarding({ ...ctx, store })).toBe('later');
    expect(ctx.countCredentials).toHaveBeenCalledWith('webauthn-passwordless');
    expect(ctx.show).toHaveBeenCalledWith(expect.objectContaining({ mode: 'passkey' }));
  });

  it('"Not now" is throttled for a week, then offered again, at most MAX_SHOWS times', async () => {
    const ctx = base();
    const store = memoryStore();
    expect(await runNewUserOnboarding({ ...ctx, store })).toBe('later');
    expect(await runNewUserOnboarding({ ...ctx, store })).toBe('throttled');
    let t = NOW + SNOOZE_MS + 1;
    expect(await runNewUserOnboarding({ ...ctx, now: () => t, store })).toBe('later');
    t += SNOOZE_MS + 1;
    expect(await runNewUserOnboarding({ ...ctx, now: () => t, store })).toBe('later');
    t += SNOOZE_MS + 1;
    expect(await runNewUserOnboarding({ ...ctx, now: () => t, store })).toBe('throttled');
    expect(ctx.show).toHaveBeenCalledTimes(MAX_SHOWS);
  });

  it('"Don\'t ask again" is permanent', async () => {
    const ctx = base();
    ctx.show.mockResolvedValue('never');
    const store = memoryStore();
    expect(await runNewUserOnboarding({ ...ctx, store })).toBe('never');
    expect(store.load().never).toBe(true);
    expect(await runNewUserOnboarding({ ...ctx, now: () => NOW + 10 * SNOOZE_MS, store })).toBe('throttled');
  });

  it('never for a user who already has a passkey', async () => {
    const ctx = base();
    ctx.countCredentials.mockResolvedValue(1);
    const store = memoryStore();
    expect(await runNewUserOnboarding({ ...ctx, store })).toBe('has-credential');
    expect(ctx.show).not.toHaveBeenCalled();
    expect(store.saved).toEqual([]);
  });

  it('stays quiet when the credentials cannot be read', async () => {
    const ctx = base();
    ctx.countCredentials.mockResolvedValue(null as never);
    expect(await runNewUserOnboarding({ ...ctx, store: memoryStore() })).toBe('unknown-credentials');
    expect(ctx.show).not.toHaveBeenCalled();
  });

  it('where passkeys are unsupported it suggests a backup password instead', async () => {
    const ctx = base();
    const out = await runNewUserOnboarding({ ...ctx, supported: async () => false, store: memoryStore() });
    expect(out).toBe('later');
    expect(ctx.countCredentials).toHaveBeenCalledWith('password');
    expect(ctx.show).toHaveBeenCalledWith(expect.objectContaining({ mode: 'password' }));
  });

  it('no suggestion for an unsupported device whose user already has a password', async () => {
    const ctx = base();
    ctx.countCredentials.mockResolvedValue(1);
    expect(await runNewUserOnboarding({ ...ctx, supported: async () => false, store: memoryStore() })).toBe('has-credential');
  });

  it('"Create a passkey" starts Keycloak webauthn registration; the password variant starts UPDATE_PASSWORD', async () => {
    const ctx = base();
    ctx.show.mockImplementation(async (o) => { await o.start(); return 'create'; });
    await runNewUserOnboarding({ ...ctx, store: memoryStore() });
    expect(h.login).toHaveBeenLastCalledWith({
      action: 'webauthn-register-passwordless',
      redirectUri: 'https://app.test/PruebaMapJapan/dashboard.html',
    });
    await runNewUserOnboarding({ ...ctx, supported: async () => false, store: memoryStore() });
    expect(h.login).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'UPDATE_PASSWORD' }));
  });

  it('works through the real prefs store with localStorage', async () => {
    const ctx = base();
    const patch = vi.fn(async () => ({}));
    const a = createPrefsStore('u1', null, patch);
    expect(await runNewUserOnboarding({ ...ctx, store: a })).toBe('later');
    // "reload": a fresh store reads the local copy
    expect(await runNewUserOnboarding({ ...ctx, store: createPrefsStore('u1', null, patch) })).toBe('throttled');
  });
});

describe('onboarding dialog', () => {
  const open = (mode: 'passkey' | 'password' = 'passkey', start: () => Promise<void> = async () => {}) => {
    document.querySelector<HTMLButtonElement>('#opener')!.focus();
    return showOnboardingDialog({ mode, start, locale: 'en' });
  };
  const q = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
  const key = (k: string, shiftKey = false) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));

  it('is a modal dialog, labelled and described, with the primary action focused', () => {
    void open();
    const d = q('[role="dialog"]');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(q('#' + d.getAttribute('aria-labelledby')!).textContent).toBe('Welcome! Sign in faster with a passkey');
    expect(q('#' + d.getAttribute('aria-describedby')!).textContent).toMatch(/fingerprint/);
    expect(q(`#${DIALOG_ID}-create`).textContent).toBe('Create a passkey');
    expect(q(`#${DIALOG_ID}-later`).textContent).toBe('Not now');
    expect(q(`#${DIALOG_ID}-never`).textContent).toBe("Don't ask again");
    expect(document.activeElement).toBe(q(`#${DIALOG_ID}-create`));
    expect(q('#m').hasAttribute('inert')).toBe(true);
  });

  it('password variant has its own wording', () => {
    void open('password');
    expect(q('h2').textContent).toBe('Set a password as a backup');
    expect(q(`#${DIALOG_ID}-create`).textContent).toBe('Set a password');
  });

  it('is built with the browser language', () => {
    document.body.innerHTML = '';
    void showOnboardingDialog({ mode: 'passkey', start: async () => {}, locale: 'es' });
    expect(q('[role="dialog"]').lang).toBe('es');
    expect(q('h2').textContent).toMatch(/Bienvenido/);
  });

  it('Not now / Don\'t ask again resolve and restore the page and focus', async () => {
    const p = open();
    q(`#${DIALOG_ID}-later`).click();
    expect(await p).toBe('later');
    expect(document.getElementById(DIALOG_ID)).toBeNull();
    expect(q('#m').hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(q('#opener'));

    const p2 = open();
    q(`#${DIALOG_ID}-never`).click();
    expect(await p2).toBe('never');
  });

  it('Escape is "Not now"', async () => {
    const p = open();
    key('Escape');
    expect(await p).toBe('later');
    expect(document.activeElement).toBe(q('#opener'));
  });

  it('traps Tab and Shift+Tab inside the dialog', () => {
    void open();
    const create = q(`#${DIALOG_ID}-create`);
    const never = q(`#${DIALOG_ID}-never`);
    never.focus();
    key('Tab');
    expect(document.activeElement).toBe(create);
    key('Tab', true);
    expect(document.activeElement).toBe(never);
    q('#opener').focus(); // focus escaped somehow
    key('Tab');
    expect(document.activeElement).toBe(create);
  });

  it('Create runs start once (double click) and resolves "create" without stealing focus back', async () => {
    const start = vi.fn(async () => {});
    const p = open('passkey', start);
    const create = q<HTMLButtonElement>(`#${DIALOG_ID}-create`);
    create.click();
    create.click();
    expect(await p).toBe('create');
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('a failing start keeps the dialog open, says so, and allows another try', async () => {
    const start = vi.fn().mockRejectedValueOnce(new Error('kc down')).mockResolvedValue(undefined);
    const p = open('passkey', start);
    const create = q<HTMLButtonElement>(`#${DIALOG_ID}-create`);
    create.click();
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/passkey setup/), 'error'));
    expect(document.getElementById(DIALOG_ID)).not.toBeNull();
    expect(create.disabled).toBe(false);
    create.click();
    expect(await p).toBe('create');
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('Escape and the other buttons are ignored while the start is in flight', async () => {
    let finish!: () => void;
    const p = open('passkey', () => new Promise<void>((r) => { finish = r; }));
    q(`#${DIALOG_ID}-create`).click();
    key('Escape');
    q(`#${DIALOG_ID}-later`).click();
    expect(document.getElementById(DIALOG_ID)).not.toBeNull();
    finish();
    expect(await p).toBe('create');
  });
});
