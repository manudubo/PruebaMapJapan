import * as L from 'leaflet';
import { TILE_PROVIDER } from '@/data/tiles';
import { getThemeConfig } from './theme';

/**
 * Shared Leaflet base map for the city pages, the trip page and the landing
 * overview: one place that sets the tile layer, the provider attribution the
 * licence requires, and the "tiles failed" fallback.
 */

export interface BaseMap {
  map: L.Map;
  tileLayer: L.TileLayer;
}

const NOTICE_CLASS = 'map-tile-notice';
const FAILED_CLASS = 'map-tiles-failed';

export function createTileLayer(): L.TileLayer {
  return L.tileLayer(getThemeConfig().tileUrl, {
    maxZoom: TILE_PROVIDER.maxZoom,
    attribution: TILE_PROVIDER.attribution,
  });
}

/**
 * When the tile server is unreachable or blocked, the map would otherwise be a
 * silent empty box. Markers still work, so say that, once, politely; the first
 * tile that does load removes the notice.
 */
function watchTileFailures(container: HTMLElement, layer: L.TileLayer): void {
  let anyLoaded = false;
  layer.on('tileerror', () => {
    if (anyLoaded || container.querySelector(`.${NOTICE_CLASS}`)) return;
    container.classList.add(FAILED_CLASS);
    const notice = document.createElement('p');
    notice.className = NOTICE_CLASS;
    notice.setAttribute('role', 'status');
    notice.textContent = 'Map imagery could not load. Markers and links still work.';
    container.appendChild(notice);
  });
  layer.on('tileload', () => {
    if (anyLoaded) return;
    anyLoaded = true;
    container.classList.remove(FAILED_CLASS);
    container.querySelector(`.${NOTICE_CLASS}`)?.remove();
  });
}

const HINT_CLASS = 'map-gesture-hint';

/** True on phones/tablets, where one finger must scroll the page rather than drag the map. */
export function isTouchPrimary(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/**
 * Scroll-hijack guard for touch screens. A map that fills the width of a phone captures every
 * vertical swipe that starts on it, so the page cannot be scrolled past it. With one-finger
 * dragging off, Leaflet leaves `touch-action: pan-x pan-y` on the container (the browser scrolls
 * the page) while its pinch handler still pans and zooms with two fingers. A one-finger drag
 * shows a short hint so the behaviour is discoverable.
 */
function guardTouchScroll(map: L.Map): void {
  const el = map.getContainer();
  let timer: number | undefined;
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1 || el.querySelector(`.${HINT_CLASS}`)) return;
    const hint = document.createElement('p');
    hint.className = HINT_CLASS;
    hint.setAttribute('role', 'status');
    hint.textContent = 'Use two fingers to move the map';
    el.appendChild(hint);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => hint.remove(), 1600);
  }, { passive: true });
}

export function createBaseMap(
  container: string | HTMLElement,
  center: L.LatLngExpression,
  zoom: number,
  options: L.MapOptions = {},
): BaseMap {
  const touch = isTouchPrimary();
  const map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
    keyboard: true,
    dragging: !touch,
    ...options,
  }).setView(center, zoom);
  if (touch && options.dragging === undefined) guardTouchScroll(map);
  // Keep the Leaflet credit but drop its decorative flag SVG; the OSM credit comes from the layer.
  map.attributionControl?.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  const tileLayer = createTileLayer();
  watchTileFailures(map.getContainer(), tileLayer);
  tileLayer.addTo(map);
  return { map, tileLayer };
}

/**
 * Apply the current theme to an existing base map. Both themes share one tile
 * URL (dark is a CSS filter on the tile pane), so Leaflet's setUrl is a no-op
 * and no tiles are re-requested; a future per-theme URL would swap in place.
 */
export function switchBaseMapTheme(layer: L.TileLayer): L.TileLayer {
  layer.setUrl(getThemeConfig().tileUrl);
  return layer;
}
