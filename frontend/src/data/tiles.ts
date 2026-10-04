/**
 * Base-map raster tile provider: the single source of truth for every Leaflet
 * map (city pages, trip page, landing overview), the CSP img-src
 * (build/cspPlugin.ts imports this file) and the tile guard tests.
 *
 * Must stay free of path aliases and DOM/Leaflet imports: the CSP plugin loads
 * it in Node while Vite's config is being resolved.
 *
 * Why OpenStreetMap: CartoDB basemaps (`*.basemaps.cartocdn.com`) began
 * answering every tile with HTTP 200 and an "API KEY REQUIRED" placeholder
 * image, so all maps showed that text instead of a map. The OSM Foundation
 * tile server needs no key and allows light use from a web app that shows
 * attribution, sends a normal browser Referer/User-Agent and does not bulk
 * prefetch (https://operations.osmfoundation.org/policies/tiles/). There is no
 * keyless dark tile set with a comparable policy, so dark mode applies a CSS
 * filter to the tile pane instead (see `.leaflet-tile-pane` in main.css).
 */

export interface TileProvider {
  /** Leaflet URL template. */
  url: string;
  /** HTML for Leaflet's attribution control (required by the provider's licence). */
  attribution: string;
  maxZoom: number;
  /** Every host the URL template can expand to; the CSP img-src is derived from it. */
  hosts: readonly string[];
}

export const TILE_PROVIDER: TileProvider = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
  hosts: ['tile.openstreetmap.org'],
};

/**
 * Tile hosts known to need an API key (or to answer with a placeholder image
 * without one). The guard test fails if any configured tile URL points at them.
 */
export const KEY_REQUIRED_TILE_HOSTS: readonly string[] = [
  'basemaps.cartocdn.com',
  'cartodb-basemaps-a.global.ssl.fastly.net',
  'tiles.stadiamaps.com',
  'tile.thunderforest.com',
  'api.maptiler.com',
  'api.mapbox.com',
];

/** CSP host-sources for the tiles, e.g. `https://tile.openstreetmap.org`. */
export function tileCspSources(provider: TileProvider = TILE_PROVIDER): string[] {
  return provider.hosts.map((host) => `https://${host}`);
}
