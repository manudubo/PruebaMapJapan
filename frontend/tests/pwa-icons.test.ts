// PWA-01: manifest / apple-touch icons are first-party files and precached.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import vm from 'vm';

const root = resolve(__dirname, '..');
const pub = resolve(root, 'public');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}
const manifest = JSON.parse(read('public/manifest.json')) as { icons: ManifestIcon[] };

/** Width/height from a PNG's IHDR chunk; throws if the file is not a PNG. */
function pngSize(file: string): [number, number] {
  const buf = readFileSync(file);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => buf[i] === b) || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`${file} is not a PNG`);
  }
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

/** Run public/sw.js and capture the list handed to cache.addAll on install. */
async function precacheList(): Promise<string[]> {
  let listed: string[] = [];
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = {
    addEventListener: (t: string, fn: (e: unknown) => void) => void (listeners[t] = fn),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
    location: { origin: 'https://example.test' },
  };
  const caches = {
    open: async () => ({
      addAll: async (list: string[]) => void (listed = list),
      put: async () => undefined,
    }),
  };
  vm.runInNewContext(read('public/sw.js'), { self, caches, console, URL, fetch: () => undefined });
  let pending: Promise<unknown> = Promise.resolve();
  listeners['install']!({ waitUntil: (p: Promise<unknown>) => void (pending = p) });
  await pending;
  return listed;
}

describe('PWA-01: manifest icons', () => {
  it('declares at least a 192px and a 512px icon plus a maskable one', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((i) => i.purpose?.split(' ').includes('maskable'))).toBe(true);
  });

  it.each(manifest.icons.map((i) => [i.src, i] as const))('%s is first-party (relative path)', (_src, icon) => {
    expect(icon.src).not.toMatch(/^(https?:)?\/\//);
  });

  it.each(manifest.icons.map((i) => [i.src, i] as const))(
    '%s exists and is a PNG of exactly the declared size',
    (_src, icon) => {
      const file = resolve(pub, icon.src);
      expect(existsSync(file)).toBe(true);
      expect(icon.type).toBe('image/png');
      const [w, h] = pngSize(file);
      expect(`${w}x${h}`).toBe(icon.sizes);
    },
  );

  it('is precached by the service worker so it works offline', async () => {
    const list = await precacheList();
    for (const icon of manifest.icons) expect(list).toContain(icon.src);
    expect(list).toContain('./icons/apple-touch-icon.png');
  });
});

describe('PWA-01: apple-touch-icon and CSP', () => {
  const pages = readdirSync(root).filter((f) => f.endsWith('.html'));

  it.each(pages)('%s references no remote icon CDN', (page) => {
    expect(read(page)).not.toMatch(/flaticon|cdn-icons/);
  });

  const withTouchIcon = pages.filter((p) => read(p).includes('apple-touch-icon'));

  it('at least the app shell pages declare an apple-touch-icon', () => {
    expect(withTouchIcon).toEqual(
      expect.arrayContaining(['index.html', 'dashboard.html', 'profile.html', 'trip.html', 'trip-edit.html']),
    );
  });

  it.each(withTouchIcon)('%s apple-touch-icon is a local 180x180 PNG', (page) => {
    const href = /rel="apple-touch-icon" href="([^"]+)"/.exec(read(page))?.[1];
    expect(href).toBe('icons/apple-touch-icon.png');
    expect(pngSize(resolve(pub, href!))).toEqual([180, 180]);
  });

  it('CSP img-src no longer allows the icon CDN', () => {
    expect(read('vite.config.ts')).not.toContain('flaticon');
  });

  it('the generator script is committed so icons are reproducible', () => {
    expect(existsSync(resolve(root, '../scripts/generate-pwa-icons.mjs'))).toBe(true);
  });
});
