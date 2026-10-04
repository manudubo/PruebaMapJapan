// Review N7: the service worker must not grow one cache entry per query-string
// variant of a page, and one missing precache file must not throw away the
// whole offline cache, while a broken core shell still fails the install.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import vm from 'vm';

const SRC = readFileSync(resolve(__dirname, '../public/sw.js'), 'utf8').replace(/__BUILD_VERSION__/g, 'v1');
const ORIGIN = 'https://x.test';
const SCOPE = `${ORIGIN}/PruebaMapJapan/`;

type Key = string | { url: string };
const keyUrl = (k: Key): string => new URL(typeof k === 'string' ? k : k.url, SCOPE).href;

function loadSw(opts: { failing?: string[] } = {}) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const store = new Map<string, unknown>();
  const failing = new Set((opts.failing ?? []).map((u) => new URL(u, SCOPE).href));
  const fetchMock = vi.fn();
  const warn = vi.fn();
  const fetchFor = async (u: string) => {
    if (failing.has(u)) throw new TypeError(`404 ${u}`);
    return { ok: true, tag: u };
  };
  const cache = {
    add: async (k: Key) => {
      const u = keyUrl(k);
      store.set(u, await fetchFor(u));
    },
    addAll: async (keys: Key[]) => {
      const urls = keys.map(keyUrl);
      const responses = await Promise.all(urls.map(fetchFor)); // atomic, like the real one
      urls.forEach((u, i) => store.set(u, responses[i]));
    },
    put: async (k: Key, res: unknown) => void store.set(keyUrl(k), res),
  };
  const caches = {
    open: async () => cache,
    keys: async () => ['japan-trip-v1'],
    delete: async () => true,
    match: async (k: Key, o?: { ignoreSearch?: boolean }) => {
      const u = new URL(keyUrl(k));
      if (o?.ignoreSearch) u.search = '';
      return store.get(u.href);
    },
  };
  vm.runInNewContext(SRC, {
    self: {
      addEventListener: (t: string, fn: (e: unknown) => void) => void (listeners[t] = fn),
      skipWaiting() {},
      clients: { claim() {} },
      registration: { scope: SCOPE },
      location: { href: `${SCOPE}sw.js` },
    },
    caches,
    fetch: fetchMock,
    console: { ...console, warn },
    URL,
    Promise,
  });
  const install = async () => {
    let p: Promise<unknown> = Promise.resolve();
    listeners['install']!({ waitUntil: (x: Promise<unknown>) => (p = x) });
    return p;
  };
  const navigate = async (url: string) => {
    let out: Promise<unknown> = Promise.resolve();
    listeners['fetch']!({
      request: { url, method: 'GET', mode: 'navigate' },
      respondWith: (p: Promise<unknown>) => (out = p),
    });
    const res = await out;
    await new Promise((r) => setTimeout(r, 0)); // let the background cache.put land
    return res;
  };
  return { install, navigate, store, fetchMock, warn };
}

const page = (n: number) => ({ ok: true, type: 'basic', tag: `p${n}`, clone: () => ({ tag: `p${n}` }) });

describe('install', () => {
  it('caches the whole precache list when everything is reachable', async () => {
    const sw = loadSw();
    await sw.install();
    expect(sw.store.has(`${SCOPE}index.html`)).toBe(true);
    expect(sw.store.has(`${SCOPE}tokyo.html`)).toBe(true);
    expect(sw.store.has(`${SCOPE}icons/icon-512.png`)).toBe(true);
  });

  it('one missing optional file does not abort the install; the rest is cached and the miss is logged', async () => {
    const sw = loadSw({ failing: ['./kyoto.html'] });
    await sw.install();
    expect(sw.store.has(`${SCOPE}kyoto.html`)).toBe(false);
    expect(sw.store.has(`${SCOPE}tokyo.html`)).toBe(true);
    expect(sw.store.has(`${SCOPE}index.html`)).toBe(true);
    expect(sw.warn).toHaveBeenCalledWith(expect.stringContaining('1'), expect.anything());
  });

  it.each(['./', './index.html', './manifest.json'])('a missing core shell file (%s) fails the install', async (core) => {
    const sw = loadSw({ failing: [core] });
    await expect(sw.install()).rejects.toThrow();
  });
});

describe('navigation caching', () => {
  it('stores query-string variants of a page under ONE normalised key', async () => {
    const sw = loadSw();
    for (let i = 0; i < 50; i++) {
      sw.fetchMock.mockResolvedValueOnce(page(i));
      await sw.navigate(`${SCOPE}trip.html?tripId=${i}&destIndex=${i % 3}`);
    }
    const tripKeys = [...sw.store.keys()].filter((k) => k.includes('trip.html'));
    expect(tripKeys).toEqual([`${SCOPE}trip.html`]);
    expect(sw.store.get(`${SCOPE}trip.html`)).toEqual({ tag: 'p49' }); // latest copy wins
  });

  it('offline, a query-string URL is served from the normalised copy', async () => {
    const sw = loadSw();
    sw.fetchMock.mockResolvedValueOnce(page(1));
    await sw.navigate(`${SCOPE}trip.html?tripId=1`);
    sw.fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    expect(await sw.navigate(`${SCOPE}trip.html?tripId=999`)).toEqual({ tag: 'p1' });
  });

  it('offline with nothing cached for that page falls back to index.html', async () => {
    const sw = loadSw();
    await sw.install();
    sw.fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    expect(await sw.navigate(`${SCOPE}profile.html?x=1`)).toEqual({ ok: true, tag: `${SCOPE}index.html` });
  });

  it('error and opaque responses are not cached', async () => {
    const sw = loadSw();
    sw.fetchMock.mockResolvedValueOnce({ ok: false, type: 'basic', clone: () => ({}) });
    await sw.navigate(`${SCOPE}dashboard.html?a=1`);
    sw.fetchMock.mockResolvedValueOnce({ ok: true, type: 'opaqueredirect', clone: () => ({}) });
    await sw.navigate(`${SCOPE}dashboard.html?a=2`);
    expect([...sw.store.keys()].some((k) => k.includes('dashboard'))).toBe(false);
  });
});
