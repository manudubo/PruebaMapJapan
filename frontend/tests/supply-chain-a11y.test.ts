// Phase 23: supply chain (SEC-15/16, INFRA-06) and a11y (A11Y-01/03) regression tests.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import vm from 'vm';

const root = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');

describe('SEC-15: no third-party Leaflet CDN', () => {
  const pages = readdirSync(root).filter((f) => f.endsWith('.html'));

  it('finds the HTML pages', () => {
    expect(pages.length).toBeGreaterThanOrEqual(13);
  });

  it.each(pages)('%s has no unpkg.com tag', (page) => {
    expect(read(page)).not.toContain('unpkg.com');
  });

  it('imports leaflet.css through Vite and keeps unpkg out of the CSP', () => {
    expect(read('src/modules/map.ts')).toContain("import 'leaflet/dist/leaflet.css'");
    expect(read('src/pages/tripDetail.ts')).toContain("import 'leaflet/dist/leaflet.css'");
    expect(read('vite.config.ts')).not.toContain('unpkg.com');
  });
});

describe('SEC-16 / INFRA-06: service worker', () => {
  const src = read('public/sw.js');

  it('derives CACHE_NAME from a build-time placeholder and drops EXTERNAL_ASSETS', () => {
    expect(src).toMatch(/const CACHE_NAME = 'japan-trip-__BUILD_VERSION__'/);
    expect(src).not.toContain('EXTERNAL_ASSETS');
    expect(src).not.toContain('unpkg.com');
  });

  function loadSw(version: string) {
    const listeners: Record<string, (e: unknown) => void> = {};
    const cacheStore = new Map<string, Map<string, unknown>>();
    const fetchMock = vi.fn();
    const caches = {
      open: async (name: string) => {
        if (!cacheStore.has(name)) cacheStore.set(name, new Map());
        const store = cacheStore.get(name)!;
        return {
          addAll: async () => undefined,
          put: async (req: { url: string }, res: unknown) => void store.set(req.url, res),
        };
      },
      keys: async () => [...cacheStore.keys()],
      delete: async (k: string) => cacheStore.delete(k),
      match: async (req: { url: string } | string) => {
        const url = typeof req === 'string' ? req : req.url;
        for (const s of cacheStore.values()) if (s.has(url)) return s.get(url);
        return undefined;
      },
    };
    const self = {
      addEventListener: (t: string, fn: (e: unknown) => void) => void (listeners[t] = fn),
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn() },
    };
    vm.runInNewContext(src.replace(/__BUILD_VERSION__/g, version), {
      self, caches, fetch: fetchMock, console,
    });
    return { listeners, cacheStore, fetchMock };
  }

  it('uses a different cache name per build version and purges old caches on activate', async () => {
    const a = loadSw('aaa');
    await a.listeners['install']!({ waitUntil: (p: Promise<unknown>) => p });
    expect([...a.cacheStore.keys()]).toEqual(['japan-trip-aaa']);

    a.cacheStore.set('japan-trip-old', new Map());
    let activated: Promise<unknown> = Promise.resolve();
    a.listeners['activate']!({ waitUntil: (p: Promise<unknown>) => (activated = p) });
    await activated;
    expect(a.cacheStore.has('japan-trip-old')).toBe(false);
  });

  it('serves navigations network-first and falls back to cache offline', async () => {
    const { listeners, cacheStore, fetchMock } = loadSw('bbb');
    const req = { url: 'https://x.test/tokyo.html', method: 'GET', mode: 'navigate' };
    const stale = { ok: true, tag: 'stale' };
    cacheStore.set('japan-trip-bbb', new Map([[req.url, stale]]));

    // Online: fresh network response wins over the cached copy.
    const fresh = { ok: true, type: 'basic', tag: 'fresh', clone: () => ({ tag: 'clone' }) };
    fetchMock.mockResolvedValueOnce(fresh);
    let out: Promise<unknown> = Promise.resolve();
    listeners['fetch']!({ request: req, respondWith: (p: Promise<unknown>) => (out = p) });
    expect(await out).toBe(fresh);

    // Offline: falls back to the cached page (refreshed by the online load).
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    listeners['fetch']!({ request: req, respondWith: (p: Promise<unknown>) => (out = p) });
    expect(await out).toEqual({ tag: 'clone' });
  });
});

describe('A11Y-01: SearchBar input has no aria-expanded', () => {
  it('does not render or toggle aria-expanded on the input', async () => {
    await import('@/components/SearchBar');
    const el = document.createElement('search-bar');
    document.body.appendChild(el);
    const input = (el.shadowRoot ?? el).querySelector('input');
    expect(input).not.toBeNull();
    expect(input!.hasAttribute('aria-expanded')).toBe(false);
    expect(read('src/components/SearchBar.ts')).not.toContain('aria-expanded');
    el.remove();
  });
});

describe('A11Y-03: tripDetail showError renders a heading', () => {
  it('builds an h1 inside the error card', () => {
    const src = read('src/pages/tripDetail.ts');
    const fn = src.slice(src.indexOf('function showError'), src.indexOf('// Main init'));
    expect(fn).toContain("document.createElement('h1')");
  });
});

describe('A11Y-05: web font is not a render-blocking CSS @import', () => {
  it('main.css has no @import of Google Fonts and pages load it non-blocking', () => {
    expect(read('src/styles/main.css')).not.toMatch(/@import\s+url\(['"]?https:\/\/fonts\.googleapis/);
    expect(read('index.html')).toContain('media="print" onload="this.media=\'all\'"');
  });
});
