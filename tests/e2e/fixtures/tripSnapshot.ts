import type { Page } from '@playwright/test';

/**
 * Normalised description of what a trip page SHOWS, extracted the same way from the demo
 * (index.html#demo and the city pages) and from a saved trip (trip.html). Two snapshots are
 * compared field by field, so a parity failure reads like
 *   days[3].items[2].marker.bg: demo="#34c759" user="#5ac8fa"
 *
 * The extractors run in the page and read the REAL Leaflet layers (window.currentMap), not
 * pixels: marker coordinates, the dashed route polyline, popup contents. DOM classes shared by
 * both renderers (.numbered-marker, .legend-item, .city-card, ...) carry the rest.
 *
 * What is deliberately NOT part of a snapshot (page chrome that legitimately differs):
 *  - the page header / title / subtitle / stats chips / countdown / progress bar / nav tabs
 *  - the "View itinerary" link target of overview popups and cards (tokyo.html vs trip.html?...)
 *  - ARIA wiring of the day buttons (role=tab vs aria-pressed)
 * Further normalisations live in `normalizeForParity` and are documented there.
 */

export interface Links { maps: string | null; directions: string | null }

export interface PopupSnap {
  day: string;
  badge: string;
  time: string;
  title: string;
  notes: string;
  links: Links;
}

export interface MarkerSnap {
  kind: 'activity' | 'hotel' | 'stop';
  alt: string;
  lat: number;
  lng: number;
  text: string;
  bg: string;
  /** Rendered with the dashed purple "alternative" style. */
  dashed: boolean;
  popup: PopupSnap | null;
}

export interface ItemSnap {
  marker: { text: string; bg: string };
  optional: boolean;
  name: string;
  time: string;
  note: string;
  links: Links;
}

export interface DaySnap {
  key: string;
  label: string;
  color: string;
  hasOptions: boolean;
  badge: string;
  items: ItemSnap[];
}

export interface CitySnapshot {
  chips: Array<{ key: string; label: string; hasOptions: boolean; title: string }>;
  days: DaySnap[];
  hotel: { name: string; links: Links } | null;
  hotelButton: boolean;
  markers: MarkerSnap[];
  view: { lat: number; lng: number; zoom: number };
}

export interface CardSnap {
  num: string;
  bg: string;
  name: string;
  /** The card's date range only ("22 Feb – 1 Mar"); counts like "8 days" are user-trip extras. */
  dates: string;
}

export interface OverviewSnapshot {
  markers: Array<{ alt: string; lat: number; lng: number; text: string; bg: string; popupTitle: string; popupDates: string }>;
  route: { points: Array<[number, number]>; dashArray: string; count: number };
  cards: CardSnap[];
  view: { lat: number; lng: number; zoom: number };
}

// ---------------------------------------------------------------------------
// In-page extractors (self-contained: they are serialised into the page)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function citySnapshotInPage(): CitySnapshot {
  const hex = (css: string): string => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
    if (!m) return css;
    return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  };
  const txt = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const bgOf = (el: Element | null | undefined): string => (el ? hex(getComputedStyle(el).backgroundColor) : '');
  const linksOf = (root: Element | null | undefined): Links => ({
    maps: root?.querySelector('a:not(.directions)')?.getAttribute('href') ?? null,
    directions: root?.querySelector('a.directions')?.getAttribute('href') ?? null,
  });

  const map = (window as any).currentMap;
  const markers: MarkerSnap[] = [];
  map.eachLayer((layer: any) => {
    if (typeof layer.getLatLng !== 'function' || !layer.getElement) return;
    const el: HTMLElement | null = layer.getElement();
    const inner = el?.querySelector('.numbered-marker, .hotel-marker') ?? null;
    if (!inner) return;
    const isHotel = inner.classList.contains('hotel-marker');
    const ll = layer.getLatLng();
    let popup: PopupSnap | null = null;
    const content = layer.getPopup?.()?.getContent?.();
    if (typeof content === 'string') {
      const doc = new DOMParser().parseFromString(content, 'text/html');
      const label = doc.querySelector('.day-label');
      const badge = txt(label?.querySelector('.optional-badge'));
      const time = txt(label?.querySelector('time'));
      const clone = label?.cloneNode(true) as HTMLElement | undefined;
      clone?.querySelectorAll('.optional-badge, time').forEach((n) => n.remove());
      popup = {
        day: txt(clone).replace(/·\s*$/, '').trim(),
        badge,
        time,
        title: txt(doc.querySelector('h4')),
        notes: txt(doc.querySelector('p')),
        links: linksOf(doc.querySelector('.popup-links')),
      };
    }
    markers.push({
      kind: isHotel ? 'hotel' : 'activity',
      alt: layer.options.alt ?? '',
      lat: ll.lat,
      lng: ll.lng,
      text: txt(inner),
      bg: bgOf(inner),
      dashed: inner.classList.contains('optional') && getComputedStyle(inner).borderTopStyle === 'dashed',
      popup,
    });
  });

  const days: DaySnap[] = [...document.querySelectorAll('#legend-grid .day-group')].map((g) => ({
    key: (g as HTMLElement).dataset['day'] ?? '',
    label: txt(g.querySelector('.day-group-label')),
    color: bgOf(g.querySelector('.day-group-color')),
    hasOptions: g.classList.contains('has-options'),
    badge: txt(g.querySelector('.day-group-badge')),
    items: [...g.querySelectorAll('.legend-item')].map((li) => {
      const strong = li.querySelector('strong');
      const time = txt(strong?.querySelector('time'));
      const clone = strong?.cloneNode(true) as HTMLElement | undefined;
      clone?.querySelectorAll('time').forEach((n) => n.remove());
      return {
        marker: { text: txt(li.querySelector('.legend-marker')), bg: bgOf(li.querySelector('.legend-marker')) },
        optional: li.classList.contains('is-optional'),
        name: txt(clone),
        time,
        note: txt(li.querySelector('small')),
        links: linksOf(li.querySelector('.legend-actions')),
      };
    }),
  }));

  const hotelEl = document.querySelector('#hotel-info');
  const hotelName = txt(hotelEl?.querySelector('span'));
  const hotelBtn = document.querySelector('#hotel-btn') as HTMLElement | null;
  const c = map.getCenter();
  return {
    chips: [...document.querySelectorAll('#day-selector .day-btn')].map((b) => ({
      key: (b as HTMLElement).dataset['day'] ?? '',
      label: txt(b),
      hasOptions: b.classList.contains('has-options'),
      title: b.getAttribute('title') ?? '',
    })),
    days,
    hotel: hotelName ? { name: hotelName, links: linksOf(hotelEl?.querySelector('.legend-actions')) } : null,
    hotelButton: !!hotelBtn && !hotelBtn.hidden && getComputedStyle(hotelBtn).display !== 'none',
    markers,
    view: { lat: c.lat, lng: c.lng, zoom: map.getZoom() },
  };
}

function overviewSnapshotInPage(): OverviewSnapshot {
  const hex = (css: string): string => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
    if (!m) return css;
    return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  };
  const txt = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const map = (window as any).currentMap;
  const markers: OverviewSnapshot['markers'] = [];
  let route: OverviewSnapshot['route'] = { points: [], dashArray: '', count: 0 };
  map.eachLayer((layer: any) => {
    if (typeof layer.getLatLngs === 'function' && layer.options?.dashArray === '8, 8') {
      const pts = (layer.getLatLngs() as Array<{ lat: number; lng: number }>).map((p) => [p.lat, p.lng] as [number, number]);
      route = { points: pts, dashArray: layer.options.dashArray, count: route.count + 1 };
    }
    if (typeof layer.getLatLng === 'function' && layer.getElement) {
      const inner = (layer.getElement() as HTMLElement | null)?.querySelector('.numbered-marker');
      if (!inner) return;
      const ll = layer.getLatLng();
      const doc = new DOMParser().parseFromString(layer.getPopup?.()?.getContent?.() ?? '', 'text/html');
      markers.push({
        alt: layer.options.alt ?? '',
        lat: ll.lat,
        lng: ll.lng,
        text: txt(inner),
        bg: hex(getComputedStyle(inner).backgroundColor),
        popupTitle: txt(doc.querySelector('h4')),
        popupDates: txt(doc.querySelector('p')),
      });
    }
  });
  const cards: CardSnap[] = [...document.querySelectorAll('#overview-cities .city-card')].map((a) => ({
    num: txt(a.querySelector('.city-marker')),
    bg: hex(getComputedStyle(a.querySelector('.city-marker')!).backgroundColor),
    name: txt(a.querySelector('.city-info strong')),
    dates: txt(a.querySelector('.city-info small')).split(' · ')[0] ?? '',
  }));
  const c = map.getCenter();
  return { markers, route, cards, view: { lat: c.lat, lng: c.lng, zoom: map.getZoom() } };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const citySnapshot = (page: Page): Promise<CitySnapshot> => page.evaluate(citySnapshotInPage);
export const overviewSnapshot = (page: Page): Promise<OverviewSnapshot> => page.evaluate(overviewSnapshotInPage);

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Directions + the activity's own coordinates are what a "View on Maps" link has to open. */
const POINT_RE = /query=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/;

/**
 * Explicit, documented differences between a demo page and a trip page that are NOT parity bugs.
 *
 *  N1  "View on Maps": the demo links come from a hand-curated table of short links
 *      (src/data/maps.ts) for ~70 places; a trip link is generated from the pin (or pasted).
 *      The URLs can never be equal, so a Maps link is reduced to present / absent, and the user's
 *      link may exist where the demo has none (user ⊇ demo). A missing link where the demo has
 *      one stays a diff. The coordinates a generated link opens are asserted separately.
 *  N2  Time: the demo has no per-place time; the user can enter one. `time` is compared
 *      apart (the test supplies the expected time) and dropped from popups/legend here.
 *  N3  Map centre: the demo hand-tunes a centre per city; a trip has one city pin that is both
 *      the overview marker and the map centre. Centres within CENTER_TOLERANCE degrees match.
 */
export const CENTER_TOLERANCE = 0.02;

export interface ParityOptions {
  /** Expected user-only times, by "dayKey#index" (N2). */
  times?: Record<string, string>;
}

function reduceLinks(demo: Links, user: Links): [Links, Links] {
  const d = { ...demo };
  const u = { ...user };
  // N1: the demo shows the pair (Maps + Directions) only for places in its table; the user may have extra
  if (d.maps === null) { u.maps = null; u.directions = null; }
  if (d.maps !== null) d.maps = 'link';
  if (u.maps !== null) u.maps = 'link';
  return [d, u];
}

export function normalizeCityPair(demo: CitySnapshot, user: CitySnapshot): [CitySnapshot, CitySnapshot] {
  const d: CitySnapshot = JSON.parse(JSON.stringify(demo));
  const u: CitySnapshot = JSON.parse(JSON.stringify(user));

  d.days.forEach((day, i) => {
    const uday = u.days[i];
    day.items.forEach((item, j) => {
      const uitem = uday?.items[j];
      if (!uitem) return;
      [item.links, uitem.links] = reduceLinks(item.links, uitem.links);
      uitem.time = ''; // N2
    });
  });
  // markers pair up by position: same layer order in both renderers
  d.markers.forEach((m, i) => {
    const um = u.markers[i];
    if (!m.popup || !um?.popup) return;
    [m.popup.links, um.popup.links] = reduceLinks(m.popup.links, um.popup.links);
    um.popup.time = ''; // N2
  });
  if (d.hotel && u.hotel) [d.hotel.links, u.hotel.links] = reduceLinks(d.hotel.links, u.hotel.links);

  // N3
  if (Math.abs(d.view.lat - u.view.lat) <= CENTER_TOLERANCE && Math.abs(d.view.lng - u.view.lng) <= CENTER_TOLERANCE) {
    u.view.lat = d.view.lat;
    u.view.lng = d.view.lng;
  }
  return [d, u];
}

export function userTimes(user: CitySnapshot): Record<string, string> {
  const out: Record<string, string> = {};
  user.days.forEach((day) => day.items.forEach((it, i) => { if (it.time) out[`${day.key}#${i}`] = it.time; }));
  return out;
}

/** The coordinates a generated "View on Maps" link points at, or null. */
export function pointOf(href: string | null): [number, number] | null {
  const m = href ? POINT_RE.exec(href) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/** Every difference between two plain JSON values, one readable line each. */
export function diffDeep(demo: unknown, user: unknown, path = ''): string[] {
  if (Array.isArray(demo) && Array.isArray(user)) {
    const out: string[] = [];
    if (demo.length !== user.length) out.push(`${path}.length: demo=${demo.length} user=${user.length}`);
    for (let i = 0; i < Math.min(demo.length, user.length); i++) out.push(...diffDeep(demo[i], user[i], `${path}[${i}]`));
    return out;
  }
  if (demo && user && typeof demo === 'object' && typeof user === 'object') {
    const keys = [...new Set([...Object.keys(demo), ...Object.keys(user)])];
    return keys.flatMap((k) => diffDeep((demo as Record<string, unknown>)[k], (user as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  }
  if (typeof demo === 'number' && typeof user === 'number') {
    return Math.abs(demo - user) < 1e-6 ? [] : [`${path}: demo=${demo} user=${user}`];
  }
  return demo === user ? [] : [`${path}: demo=${JSON.stringify(demo)} user=${JSON.stringify(user)}`];
}

export interface ExpectedGap {
  id: string;
  /** Why this cannot be fixed in the test (product / backend decision). */
  reason: string;
  /** Matches the diff lines this gap explains. */
  match: RegExp;
}

/**
 * Split diff lines into those explained by a documented gap and the rest. A gap that explains no
 * diff is reported as "stale": it was fixed (remove it) or the test no longer exercises it.
 */
export function applyGaps(diffs: string[], gaps: ExpectedGap[]): { unexpected: string[]; stale: string[]; explained: string[] } {
  const used = new Set<string>();
  const unexpected: string[] = [];
  const explained: string[] = [];
  for (const line of diffs) {
    const gap = gaps.find((g) => g.match.test(line));
    if (gap) { used.add(gap.id); explained.push(line); } else unexpected.push(line);
  }
  return { unexpected, stale: gaps.filter((g) => !used.has(g.id)).map((g) => g.id), explained };
}
