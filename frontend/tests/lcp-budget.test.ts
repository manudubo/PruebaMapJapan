// A11Y-05: landing / city-page LCP regressions. Static checks on the page sources and public assets
// (the production build copies them verbatim; Vite only prefixes the base path).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');
const pages = readdirSync(root).filter((f) => f.endsWith('.html'));
const kb = (p: string): number => statSync(resolve(root, 'public', p)).size / 1024;

describe('no font-load opacity gate', () => {
  it.each(pages)('%s does not hide <body> until fonts/load', (page) => {
    const html = read(page);
    expect(html).not.toMatch(/body\s*\{[^}]*opacity:\s*0/);
    expect(html).not.toContain('document.fonts.ready');
    expect(html).not.toMatch(/addEventListener\('load',[^)]*classList\.add\('ready'\)/);
  });

  it('web font stays non-blocking with font-display: swap', () => {
    const html = read('index.html');
    expect(html).toMatch(/fonts\.googleapis\.com\/css2\?[^"]*display=swap[^"]*"\s+media="print"\s+onload="this\.media='all'"/);
  });

  it('declares a metric-matched Inter fallback so the swap does not shift layout', () => {
    const css = read('src/styles/main.css');
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*'Inter Fallback'[^}]*size-adjust:\s*[\d.]+%[^}]*ascent-override/s);
    expect(css).toMatch(/--jp-font:\s*'Inter',\s*'Inter Fallback'/);
  });

  it('reserves space for the nav and search custom elements until they upgrade (CLS)', () => {
    const css = read('src/styles/main.css');
    expect(css).toMatch(/travel-nav:not\(:defined\)\s*\{[^}]*min-height:\s*57px/);
    expect(css).toMatch(/search-bar:not\(:defined\)\s*\{[^}]*min-height:\s*55px/);
  });
});

describe('landing hero image (LCP)', () => {
  const html = read('index.html');
  const widths = [640, 1280, 1920];

  it('is preloaded as a high-priority image for every size bucket', () => {
    for (const w of widths) {
      const re = new RegExp(`<link rel="preload" as="image" href="/demo-hero-${w}\\.avif" type="image/avif" media="[^"]+" fetchpriority="high">`);
      expect(html).toMatch(re);
    }
  });

  it('is declared in CSS (image-set avif -> webp -> jpg), not injected by JS after load', () => {
    for (const w of widths) {
      expect(html).toContain(`url('/demo-hero-${w}.avif') type('image/avif'), url('/demo-hero-${w}.webp') type('image/webp'), url('/demo-hero.jpg') type('image/jpeg')`);
    }
    expect(html).not.toContain("setProperty('--landing-hero-image'");
  });

  it('only references files that exist', () => {
    const urls = [...html.matchAll(/(?:href=|url\()['"]?\/(demo-hero[^'")\s]*)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(9);
    for (const u of urls) expect(existsSync(resolve(root, 'public', u)), u).toBe(true);
  });

  it('keeps the file sizes within budget', () => {
    expect(kb('demo-hero-640.avif')).toBeLessThanOrEqual(30); // phones
    expect(kb('demo-hero-1280.avif')).toBeLessThanOrEqual(60);
    expect(kb('demo-hero-1920.avif')).toBeLessThanOrEqual(120);
    for (const w of widths) expect(kb(`demo-hero-${w}.webp`)).toBeLessThanOrEqual(130);
    expect(kb('demo-hero.jpg')).toBeLessThanOrEqual(150); // was 677 KB
  });
});

describe('non-critical JS stays off the critical path', () => {
  const main = read('src/main.ts');

  it('main.ts does not statically import Leaflet-backed modules', () => {
    expect(main).not.toMatch(/from '@\/modules\/(map|overviewMap|baseMap)'/);
    expect(main).not.toMatch(/from 'leaflet'/);
  });

  it('loads the map code on demand', () => {
    expect(main).toContain("import('@/modules/map')");
    expect(main).toContain("import('@/modules/overviewMap')");
  });

  it('each lazily loaded map module brings its own leaflet.css (it no longer rides in the entry chunk)', () => {
    expect(read('src/modules/overviewMap.ts')).toContain("import 'leaflet/dist/leaflet.css'");
    expect(read('src/modules/map.ts')).toContain("import 'leaflet/dist/leaflet.css'");
  });

  it('the landing observer module does not import Leaflet', () => {
    expect(read('src/modules/overviewLazy.ts')).not.toMatch(/from 'leaflet'/);
    expect(read('src/modules/nav.ts')).not.toMatch(/from 'leaflet'/);
  });
});
