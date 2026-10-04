import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as L from 'leaflet';
import { THEME_CONFIG } from '@/modules/theme';
import { TILE_PROVIDER, KEY_REQUIRED_TILE_HOSTS, tileCspSources } from '@/data/tiles';
import { createBaseMap, switchBaseMapTheme } from '@/modules/baseMap';
import { buildCsp } from '../build/cspPlugin';

// Guard for the "API KEY REQUIRED" regression: CartoDB tiles started returning a
// placeholder image (HTTP 200), and nothing in the test suite noticed because every
// e2e spec stubs tiles. These checks pin the tile configuration to an allow-list of
// keyless hosts and keep the CSP / service worker / attribution in sync with it.

const hostOf = (template: string): string => new URL(template.replace(/\{[a-z]\}/g, 'a')).hostname;
const matchesHost = (host: string, banned: string): boolean => host === banned || host.endsWith(`.${banned}`);

describe('tile provider configuration', () => {
  it.each(Object.entries(THEME_CONFIG))('%s theme uses an https tile URL on an allow-listed host', (_theme, cfg) => {
    expect(cfg.tileUrl).toMatch(/^https:\/\//);
    expect(TILE_PROVIDER.hosts).toContain(hostOf(cfg.tileUrl));
  });

  it('never points at a host that needs an API key (CartoDB, Stadia, Thunderforest, ...)', () => {
    const configured = [TILE_PROVIDER.url, ...Object.values(THEME_CONFIG).map((c) => c.tileUrl)].map(hostOf);
    for (const host of [...configured, ...TILE_PROVIDER.hosts]) {
      for (const banned of KEY_REQUIRED_TILE_HOSTS) expect(matchesHost(host, banned), `${host} ~ ${banned}`).toBe(false);
    }
  });

  it('keeps the URL template free of key/token parameters and subdomain rotation', () => {
    expect(TILE_PROVIDER.url).not.toMatch(/key|token|access/i);
    // {s} would expand to hosts that are not in the allow-list / CSP.
    expect(TILE_PROVIDER.url).not.toContain('{s}');
  });

  it('carries the attribution the OSM licence requires', () => {
    expect(TILE_PROVIDER.attribution).toContain('OpenStreetMap');
    expect(TILE_PROVIDER.attribution).toContain('contributors');
    expect(TILE_PROVIDER.attribution).toContain('href="https://www.openstreetmap.org/copyright"');
  });

  it('CSP img-src allows exactly the configured tile hosts and no longer CartoDB', () => {
    const imgSrc = buildCsp({ apiUrl: undefined, keycloakUrl: undefined, target: 'build' })
      .split('; ')
      .find((d) => d.startsWith('img-src '))!;
    for (const src of tileCspSources()) expect(imgSrc.split(' ')).toContain(src);
    expect(imgSrc).not.toContain('cartocdn');
  });

  it('service worker never caches tiles (they are network-only, per the OSM tile policy)', () => {
    const sw = readFileSync(resolve(__dirname, '../public/sw.js'), 'utf8');
    const list = /NETWORK_ONLY_DOMAINS = \[([^\]]*)\]/.exec(sw)![1]!;
    for (const host of TILE_PROVIDER.hosts) expect(list).toContain(`'${host}'`);
  });
});

describe('createBaseMap', () => {
  let el: HTMLDivElement;
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    el = document.createElement('div');
    el.id = 'map';
    document.body.appendChild(el);
  });
  afterEach(() => {
    el.remove();
    document.documentElement.removeAttribute('data-theme');
  });

  it('shows a visible attribution control with the OSM credit', () => {
    createBaseMap(el, [35, 135], 10);
    const attribution = el.querySelector('.leaflet-control-attribution');
    expect(attribution).not.toBeNull();
    expect(attribution!.textContent).toContain('OpenStreetMap contributors');
    expect(attribution!.querySelector('a[href="https://www.openstreetmap.org/copyright"]')).not.toBeNull();
  });

  it('uses the provider URL and zoom limit', () => {
    const { tileLayer } = createBaseMap(el, [35, 135], 10);
    expect((tileLayer as unknown as { _url: string })._url).toBe(TILE_PROVIDER.url);
    expect(tileLayer.options.maxZoom).toBe(TILE_PROVIDER.maxZoom);
  });

  it('theme switch keeps the same tile layer (dark is a CSS filter, no tile reload)', () => {
    const { map, tileLayer } = createBaseMap(el, [35, 135], 10);
    let redraws = 0;
    tileLayer.on('loading', () => redraws++);
    document.documentElement.setAttribute('data-theme', 'dark');
    const after = switchBaseMapTheme(tileLayer);
    expect(after).toBe(tileLayer);
    expect(map.hasLayer(tileLayer)).toBe(true);
    expect(redraws).toBe(0);
  });

  it('shows a polite notice when tiles fail before any loaded, and clears it on the first good tile', () => {
    const { tileLayer } = createBaseMap(el, [35, 135], 10);
    const tile = document.createElement('img');
    tileLayer.fire('tileerror', { tile, coords: L.point(0, 0) });
    tileLayer.fire('tileerror', { tile, coords: L.point(1, 0) });
    const notices = el.querySelectorAll('.map-tile-notice');
    expect(notices).toHaveLength(1);
    expect(notices[0]!.getAttribute('role')).toBe('status');
    expect(el.classList.contains('map-tiles-failed')).toBe(true);

    tileLayer.fire('tileload', { tile, coords: L.point(2, 0) });
    expect(el.querySelector('.map-tile-notice')).toBeNull();
    expect(el.classList.contains('map-tiles-failed')).toBe(false);
  });
});
