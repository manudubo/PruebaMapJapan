import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import DOMPurify from 'dompurify';
import { ITINERARY } from '@/data/itinerary';
import { getThemeConfig } from './theme';
import { createBaseMap } from './baseMap';
import { DeclutteredMarker, declutterMarkers } from './declutter';
import { announceToScreenReader, escapeHtml } from './utils';
import { setStyle } from './dom';

/**
 * Trip overview map on the landing demo (#demo): every city of the demo
 * itinerary, numbered in visiting order and joined by a dashed route line, with
 * the "Cities" card grid below it kept in sync.
 *
 * Restored from the last version that had it (ab6b603, removed by 6ff0f80):
 * same palette, 32px numbered squares, popup ("View itinerary"), dashed route
 * and initial view. Additions: keyboard/screen-reader labels, list <-> marker
 * selection sync, theme-aware route colour, lazy initialisation.
 */

export interface OverviewStop {
  key: string;
  number: number;
  name: string;
  /** Unique, human label (the second Tokyo stay is "Tokyo (return)"). */
  label: string;
  /** Short date range without the year, as in the original cards ("8–13 Mar"). */
  dates: string;
  coords: [number, number];
  color: string;
  link: string;
}

export const OVERVIEW_VIEW = { center: [35.5, 137.0] as [number, number], zoom: 6 };

export const PALETTE = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#5ac8fa', '#007aff', '#af52de', '#ff2d55'];

/**
 * Marker positions from the original overview. They differ slightly from the
 * city-map centres on purpose: the return stay in Tokyo is nudged so its marker
 * does not hide marker 1.
 */
const STOP_COORDS: Record<string, [number, number]> = {
  tokyo: [35.6762, 139.7050],
  nagoya: [35.1815, 136.9066],
  takayama: [36.1400, 137.2500],
  kyoto: [35.0116, 135.7681],
  osaka: [34.6937, 135.5023],
  naoshima: [34.4600, 133.9950],
  hakone: [35.2330, 139.1070],
  tokyo2: [35.6862, 139.7150],
};

export function getOverviewStops(): OverviewStop[] {
  const seen = new Map<string, number>();
  return Object.entries(ITINERARY).map(([key, city], idx) => {
    const visits = (seen.get(city.name) ?? 0) + 1;
    seen.set(city.name, visits);
    return {
      key,
      number: idx + 1,
      name: city.name,
      label: visits > 1 ? `${city.name} (return)` : city.name,
      dates: city.dates.replace(/\s+\d{4}$/, ''),
      coords: STOP_COORDS[key] ?? city.center,
      color: PALETTE[idx % PALETTE.length]!,
      link: `${key}.html`,
    };
  });
}

function stopIcon(stop: OverviewStop): L.DivIcon {
  const div = document.createElement('div');
  div.className = 'numbered-marker';
  setStyle(div, 'background', stop.color);
  setStyle(div, 'width', '32px');
  setStyle(div, 'height', '32px');
  setStyle(div, 'font-size', '13px');
  div.textContent = String(stop.number);
  return L.divIcon({ className: 'custom-marker', html: div, iconSize: [32, 32], iconAnchor: [16, 16] });
}

function popupHtml(stop: OverviewStop): string {
  return DOMPurify.sanitize(
    `<h4>${escapeHtml(stop.name)}</h4>${stop.dates ? `<p>${escapeHtml(stop.dates)}</p>` : ''}<p><a href="${escapeHtml(stop.link)}" class="overview-popup-link">View itinerary</a></p>`,
  );
}

export interface OverviewMap {
  map: L.Map;
  route: L.Polyline;
  markers: Map<string, L.Marker>;
  /** Select a city: open its popup and highlight its card. */
  select(key: string): void;
  /** Remove the map and its global listeners (pages that swap views without reloading). */
  destroy(): void;
}

export interface OverviewMapOptions {
  /** Initial view. Default: the demo's fixed Japan view; 'fit' frames the stops (saved trips). */
  view?: { center: [number, number]; zoom: number } | 'fit';
  /** Nudge markers that would overlap apart (saved trips: two stops can share a spot). */
  declutter?: boolean;
}

/** The demo's overview: every city of the static itinerary. */
export function initOverviewMap(container: HTMLElement, list: HTMLElement | null): OverviewMap {
  return createOverviewMap(getOverviewStops(), container, list);
}

/**
 * Overview map for any list of stops: numbered markers in order, a dashed route line joining
 * them, popups linking to each city, and card <-> marker selection sync with `list`.
 * Shared by the demo (above) and by saved trips (pages/tripDetail.ts).
 */
export function createOverviewMap(
  stops: OverviewStop[],
  container: HTMLElement,
  list: HTMLElement | null,
  options: OverviewMapOptions = {},
): OverviewMap {
  const view = options.view ?? OVERVIEW_VIEW;
  const start = view === 'fit' ? OVERVIEW_VIEW : view;
  const { map, tileLayer } = createBaseMap(container, start.center, start.zoom);
  if (view === 'fit' && stops.length === 1) map.setView(stops[0]!.coords, 10);
  else if (view === 'fit' && stops.length > 1) {
    map.fitBounds(L.latLngBounds(stops.map((s) => s.coords)), { padding: [48, 48], maxZoom: 10 });
  }
  window.currentMap = map;
  window.currentTileLayer = tileLayer;

  const cards = new Map<string, HTMLElement>();
  list?.querySelectorAll<HTMLElement>('[data-city]').forEach((el) => cards.set(el.dataset.city!, el));

  const setSelectedCard = (key: string | null): void => {
    cards.forEach((card, k) => {
      const on = k === key;
      card.classList.toggle('is-selected', on);
      if (on) card.setAttribute('aria-current', 'true');
      else card.removeAttribute('aria-current');
    });
  };

  const markers = new Map<string, L.Marker>();
  for (const stop of stops) {
    const markerOptions = { icon: stopIcon(stop), alt: stop.label, riseOnHover: true };
    const marker = (options.declutter ? new DeclutteredMarker(stop.coords, markerOptions) : L.marker(stop.coords, markerOptions))
      .bindPopup(popupHtml(stop))
      .addTo(map);
    const icon = marker.getElement();
    icon?.setAttribute('aria-label', `${stop.number}. ${stop.label}${stop.dates ? `, ${stop.dates}` : ''} – show details`);
    icon?.setAttribute('data-city', stop.key);

    // Opened from the keyboard (Enter on the focused marker): move focus into the
    // popup so its link is the next thing a keyboard / screen-reader user reaches.
    let fromKeyboard = false;
    icon?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fromKeyboard = true; });
    marker.on('popupopen', (e) => {
      setSelectedCard(stop.key);
      if (fromKeyboard) e.popup.getElement()?.querySelector<HTMLElement>('.overview-popup-link')?.focus();
      fromKeyboard = false;
    });
    marker.on('popupclose', () => {
      if (cards.get(stop.key)?.classList.contains('is-selected')) setSelectedCard(null);
    });
    markers.set(stop.key, marker);
  }

  if (options.declutter) {
    const all = [...markers.values()] as DeclutteredMarker[];
    const spread = (): void => { declutterMarkers(map, all); };
    spread();
    map.on('zoomend', spread);
  }

  const route = L.polyline(stops.map((s) => s.coords), {
    color: getThemeConfig().routeColor, weight: 2, opacity: 0.5, dashArray: '8, 8',
  }).addTo(map);
  const onTheme = (): void => { route.setStyle({ color: getThemeConfig().routeColor }); };
  window.addEventListener('theme-changed', onTheme);

  // List -> map: hovering or focusing a card highlights its marker. The cards stay
  // plain links (activating one navigates to the city), as in the original.
  const highlight = (target: EventTarget | null, on: boolean): void => {
    const card = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-city]');
    const icon = card ? markers.get(card.dataset.city!)?.getElement() : undefined;
    icon?.classList.toggle('is-highlighted', on);
  };
  list?.addEventListener('focusin', (e) => highlight(e.target, true));
  list?.addEventListener('focusout', (e) => highlight(e.target, false));
  list?.addEventListener('mouseover', (e) => highlight(e.target, true));
  list?.addEventListener('mouseout', (e) => highlight(e.target, false));

  announceToScreenReader(`Overview map loaded with ${stops.length} cities`);

  return {
    map,
    route,
    markers,
    select(key: string) {
      markers.get(key)?.openPopup();
    },
    destroy() {
      window.removeEventListener('theme-changed', onTheme);
      map.remove();
    },
  };
}

export { observeOverviewMap } from './overviewLazy';
