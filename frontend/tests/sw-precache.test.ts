import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import vm from 'vm';
import { swVersionPlugin } from '../build/swVersionPlugin';

const SW_SRC = readFileSync(resolve(__dirname, '../public/sw.js'), 'utf8');

function fakeBuild(files: Record<string, string>): string {
  const out = mkdtempSync(join(tmpdir(), 'sw-precache-'));
  mkdirSync(join(out, 'assets'), { recursive: true });
  writeFileSync(join(out, 'sw.js'), SW_SRC);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(out, name, '..'), { recursive: true });
    writeFileSync(join(out, name), body);
  }
  return out;
}

function stamp(out: string): string {
  const plugin = swVersionPlugin() as unknown as {
    configResolved: (c: { root: string; build: { outDir: string } }) => void;
    closeBundle: () => void;
  };
  plugin.configResolved({ root: out, build: { outDir: '.' } });
  plugin.closeBundle();
  return readFileSync(join(out, 'sw.js'), 'utf8');
}

async function installedUrls(sw: string): Promise<string[]> {
  let added: string[] = [];
  const listeners: Record<string, (e: unknown) => void> = {};
  vm.runInNewContext(sw, {
    self: { addEventListener: (t: string, f: (e: unknown) => void) => void (listeners[t] = f), skipWaiting() {}, clients: { claim() {} } },
    caches: { open: async () => ({ addAll: async (urls: string[]) => void (added = urls) }) },
    fetch: async () => undefined,
    console,
  });
  await listeners['install']!({ waitUntil: (p: Promise<unknown>) => p });
  return added;
}

describe('service worker precache stamping', () => {
  it('precaches every emitted hashed asset (incl. nested) next to the HTML shell', async () => {
    const out = fakeBuild({
      'assets/main-abc.js': 'a', 'assets/leaflet-def.js': 'b', 'assets/Navbar-ghi.css': 'c', 'assets/img/x-1.png': 'd',
      'index.html': '<html/>',
    });
    const sw = stamp(out);
    expect(sw).not.toContain('__BUILD_ASSETS__');
    expect(sw).not.toContain('__BUILD_VERSION__');
    const urls = await installedUrls(sw);
    expect(urls).toEqual(expect.arrayContaining([
      './index.html', './tokyo.html', './manifest.json',
      './assets/main-abc.js', './assets/leaflet-def.js', './assets/Navbar-ghi.css', './assets/img/x-1.png',
    ]));
    expect(urls.every((u) => u.startsWith('./'))).toBe(true);
  });

  it('cache version changes when an asset changes and the asset list is deterministic', () => {
    const a = stamp(fakeBuild({ 'assets/main-1.js': 'v1' }));
    const b = stamp(fakeBuild({ 'assets/main-1.js': 'v2' }));
    const a2 = stamp(fakeBuild({ 'assets/main-1.js': 'v1' }));
    const name = (s: string): string => /japan-trip-([0-9a-f]{12})/.exec(s)![1]!;
    expect(name(a)).not.toBe(name(b));
    expect(name(a)).toBe(name(a2));
  });

  it('the unstamped source still parses (dev/test) and precaches only the shell', async () => {
    const urls = await installedUrls(SW_SRC.replace(/__BUILD_VERSION__/g, 'dev'));
    expect(urls).toContain('./index.html');
    expect(urls.some((u) => u.includes('assets/'))).toBe(false);
  });
});
