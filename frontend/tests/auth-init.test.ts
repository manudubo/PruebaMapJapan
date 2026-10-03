// QA follow-up (findings 3 + 4): Keycloak init must be bounded, retryable and must never be
// initialised twice for one attempt. keycloak-js is mocked; each instance records its init().
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface Deferred { resolve: (v: boolean) => void; reject: (e: unknown) => void; promise: Promise<boolean> }
function deferred(): Deferred {
  let resolve!: (v: boolean) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<boolean>((res, rej) => { resolve = res; reject = rej; });
  return { resolve, reject, promise };
}

const h = vi.hoisted(() => ({
  instances: [] as Array<Record<string, unknown>>,
  nextInit: [] as Array<() => Promise<boolean>>,
}));

vi.mock('keycloak-js', () => ({
  default: class FakeKeycloak {
    authenticated = false;
    token: string | undefined;
    tokenParsed: Record<string, unknown> | undefined;
    onTokenExpired?: () => void;
    didInitialize = false;
    init = vi.fn(() => {
      if (this.didInitialize) throw new Error("A 'Keycloak' instance can only be initialized once.");
      this.didInitialize = true;
      const impl = h.nextInit.shift() ?? (() => new Promise<boolean>(() => {}));
      return impl().then((auth) => {
        this.authenticated = auth;
        this.token = auth ? 'tok' : undefined;
        return auth;
      });
    });
    login = vi.fn(async () => {
      if (!this.didInitialize) throw new Error('adapter not loaded');
    });
    updateToken = vi.fn(async () => { throw new Error('refresh failed'); });
    isTokenExpired = vi.fn(() => true);
    constructor() { h.instances.push(this as unknown as Record<string, unknown>); }
  },
}));

import * as auth from '@/auth/keycloak';

const totalInits = (): number =>
  h.instances.reduce((n, kc) => n + (kc['init'] as ReturnType<typeof vi.fn>).mock.calls.length, 0);

function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
}

beforeEach(() => {
  vi.useFakeTimers();
  setOnline(true);
  h.instances.length = 0;
  h.nextInit.length = 0;
  auth.__resetAuthForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('initKeycloak: bounded', () => {
  it('resolves normally when Keycloak answers in time', async () => {
    h.nextInit.push(() => Promise.resolve(false));
    await expect(auth.initKeycloak()).resolves.toBe(false);
    expect(auth.getAuthStatus()).toBe('anonymous');
  });

  it('rejects with AuthUnavailableError(timeout) after AUTH_INIT_TIMEOUT_MS when Keycloak hangs', async () => {
    const p = auth.initKeycloak();
    const seen = vi.fn();
    p.catch(seen);
    await vi.advanceTimersByTimeAsync(auth.AUTH_INIT_TIMEOUT_MS - 1);
    expect(seen).not.toHaveBeenCalled();
    expect(auth.getAuthStatus()).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).rejects.toMatchObject({ name: 'AuthUnavailableError', reason: 'timeout' });
    expect(auth.getAuthStatus()).toBe('unavailable');
    expect(auth.getAuthUnavailableReason()).toBe('timeout');
  });

  it('keeps the timeout short (a few seconds, well under keycloak-js 10 s iframe timeout)', () => {
    expect(auth.AUTH_INIT_TIMEOUT_MS).toBeGreaterThanOrEqual(2000);
    expect(auth.AUTH_INIT_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });

  it('maps a rejection (e.g. 3p-cookie iframe timeout, 500/HTML page) to AuthUnavailableError(error)', async () => {
    const cause = new Error('Timeout when waiting for 3rd party check iframe message.');
    h.nextInit.push(() => Promise.reject(cause));
    await expect(auth.initKeycloak()).rejects.toMatchObject({ reason: 'error', cause });
    expect(auth.getAuthStatus()).toBe('unavailable');
    expect(auth.getAuthUnavailableReason()).toBe('error');
  });

  it('does not wait at all when the browser is offline', async () => {
    setOnline(false);
    await expect(auth.initKeycloak()).rejects.toMatchObject({ reason: 'offline' });
    expect(auth.getAuthStatus()).toBe('unavailable');
    expect(totalInits()).toBe(0);
  });
});

describe('initKeycloak: single init', () => {
  it('shares one keycloak.init() between concurrent callers (navbar + page)', async () => {
    h.nextInit.push(() => Promise.resolve(true));
    const [a, b, c] = await Promise.all([auth.initKeycloak(), auth.initKeycloak(), auth.initKeycloak()]);
    expect([a, b, c]).toEqual([true, true, true]);
    expect(totalInits()).toBe(1);
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('late success after the timeout updates status and listeners without a second init', async () => {
    const d = deferred();
    h.nextInit.push(() => d.promise);
    const statuses: string[] = [];
    auth.onAuthStatusChange((s) => statuses.push(s));

    const first = auth.initKeycloak();
    first.catch(() => {});
    await vi.advanceTimersByTimeAsync(auth.AUTH_INIT_TIMEOUT_MS);
    expect(auth.getAuthStatus()).toBe('unavailable');

    d.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.getAuthStatus()).toBe('authenticated');
    expect(statuses).toEqual(['unavailable', 'authenticated']);
    // Later callers see the late answer, not the stale timeout.
    await expect(auth.initKeycloak()).resolves.toBe(true);
    expect(totalInits()).toBe(1);
  });

  it('late anonymous answer flips unavailable -> anonymous', async () => {
    const d = deferred();
    h.nextInit.push(() => d.promise);
    auth.initKeycloak().catch(() => {});
    await vi.advanceTimersByTimeAsync(auth.AUTH_INIT_TIMEOUT_MS);
    d.resolve(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.getAuthStatus()).toBe('anonymous');
  });
});

describe('retryAuth', () => {
  it('after a hard failure, retries on a fresh keycloak-js instance (init-once rule respected)', async () => {
    h.nextInit.push(() => Promise.reject(new Error('down')));
    await auth.initKeycloak().catch(() => {});
    const firstInstance = auth.keycloak;

    h.nextInit.push(() => Promise.resolve(true));
    await expect(auth.retryAuth()).resolves.toBe(true);
    expect(auth.keycloak).not.toBe(firstInstance);
    expect(auth.getAuthStatus()).toBe('authenticated');
    expect(totalInits()).toBe(2);
    for (const kc of h.instances) {
      expect((kc['init'] as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(1);
    }
  });

  it('rapid retry clicks share one attempt', async () => {
    h.nextInit.push(() => Promise.reject(new Error('down')));
    await auth.initKeycloak().catch(() => {});
    const d = deferred();
    h.nextInit.push(() => d.promise);

    const retries = Array.from({ length: 10 }, () => auth.retryAuth());
    expect(new Set(retries).size).toBe(1);
    expect(auth.getAuthStatus()).toBe('pending');
    d.resolve(false);
    await Promise.all(retries);
    expect(totalInits()).toBe(2);
    expect(auth.getAuthStatus()).toBe('anonymous');
  });

  it('Retry during a slow first attempt: fresh instance, and whichever answers first wins', async () => {
    const d1 = deferred();
    const d2 = deferred();
    h.nextInit.push(() => d1.promise, () => d2.promise);
    auth.initKeycloak().catch(() => {});
    await vi.advanceTimersByTimeAsync(auth.AUTH_INIT_TIMEOUT_MS);
    const firstInstance = auth.keycloak;

    const r = auth.retryAuth();
    r.catch(() => {});
    expect(auth.getAuthStatus()).toBe('pending');
    expect(auth.keycloak).not.toBe(firstInstance);

    d1.resolve(true); // the original slow attempt answers first
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.getAuthStatus()).toBe('authenticated');
    expect(auth.keycloak).toBe(firstInstance); // adopted: its tokens are the live ones
    expect(auth.isAuthenticated()).toBe(true);

    d2.resolve(false); // the later answer is ignored
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.getAuthStatus()).toBe('authenticated');
    for (const kc of h.instances) {
      expect((kc['init'] as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(1);
    }
  });

  it('an older attempt failing after a Retry does not override the newer one', async () => {
    const d1 = deferred();
    const d2 = deferred();
    h.nextInit.push(() => d1.promise, () => d2.promise);
    auth.initKeycloak().catch(() => {});
    await vi.advanceTimersByTimeAsync(auth.AUTH_INIT_TIMEOUT_MS);
    const r = auth.retryAuth();
    r.catch(() => {});
    d1.reject(new Error('Timeout when waiting for 3rd party check iframe message.'));
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.getAuthStatus()).toBe('pending');
    d2.resolve(false);
    await expect(r).resolves.toBe(false);
    expect(auth.getAuthStatus()).toBe('anonymous');
  });

  it('retry that times out again returns to unavailable (never stuck on pending)', async () => {
    auth.initKeycloak().catch(() => {});
    await vi.advanceTimersByTimeAsync(auth.AUTH_INIT_TIMEOUT_MS);
    const r = auth.retryAuth();
    r.catch(() => {});
    await vi.advanceTimersByTimeAsync(auth.AUTH_INIT_TIMEOUT_MS);
    await expect(r).rejects.toMatchObject({ reason: 'timeout' });
    expect(auth.getAuthStatus()).toBe('unavailable');
  });

  it('a hung attempt (silent-SSO iframe has no timeout) never blocks Retry', async () => {
    auth.initKeycloak().catch(() => {}); // never settles
    await vi.advanceTimersByTimeAsync(auth.AUTH_INIT_TIMEOUT_MS);
    h.nextInit.push(() => Promise.resolve(false));
    await expect(auth.retryAuth()).resolves.toBe(false);
    expect(h.instances.length).toBe(2);
    expect(auth.getAuthStatus()).toBe('anonymous');
  });

  it('network flapping: offline -> online event retries automatically, once', async () => {
    setOnline(false);
    await auth.initKeycloak().catch(() => {});
    expect(auth.getAuthStatus()).toBe('unavailable');

    setOnline(true);
    h.nextInit.push(() => Promise.resolve(false));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.getAuthStatus()).toBe('anonymous');
    expect(totalInits()).toBe(1);
  });

  it('is a no-op once signed in or signed out', async () => {
    h.nextInit.push(() => Promise.resolve(true));
    await auth.initKeycloak();
    await expect(auth.retryAuth()).resolves.toBe(true);
    expect(totalInits()).toBe(1);
  });
});

describe('session edge cases', () => {
  it('login() works even when init was skipped because the browser was offline', async () => {
    setOnline(false);
    await auth.initKeycloak().catch(() => {});
    await expect(auth.login('https://example.test/')).resolves.toBeUndefined();
    expect(auth.keycloak.login).toHaveBeenCalled();
  });

  it('token expiry with Keycloak down: refresh fails quietly, no re-init, status stays authenticated', async () => {
    h.nextInit.push(() => Promise.resolve(true));
    await auth.initKeycloak();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kc = auth.keycloak as unknown as { onTokenExpired?: () => void };
    kc.onTokenExpired?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/refresh failed/));
    expect(totalInits()).toBe(1);
    expect(auth.getAuthStatus()).toBe('authenticated');
    await expect(auth.getToken()).rejects.toThrow(/log in again/);
    warn.mockRestore();
  });

  it('a throwing listener does not break the others', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    auth.onAuthStatusChange(() => { throw new Error('boom'); });
    auth.onAuthStatusChange(good);
    h.nextInit.push(() => Promise.resolve(false));
    await auth.initKeycloak();
    expect(good).toHaveBeenCalledWith('anonymous');
    err.mockRestore();
  });
});
