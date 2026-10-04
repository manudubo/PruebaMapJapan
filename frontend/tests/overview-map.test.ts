import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as L from 'leaflet';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ITINERARY } from '@/data/itinerary';
import { getOverviewStops, initOverviewMap, observeOverviewMap, OVERVIEW_VIEW } from '@/modules/overviewMap';

// Restored trip overview (removed from the landing by 6ff0f80). The look follows the
// last version that had it (ab6b603): numbered 32px squares in the original palette,
// dashed route line in itinerary order, popup with "View itinerary", setView([35.5,137],6),
// and the "Cities" card grid below the map.

const OLD_PALETTE = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#5ac8fa', '#007aff', '#af52de', '#ff2d55'];

describe('getOverviewStops', () => {
  it('lists every city of the demo itinerary, in itinerary order', () => {
    const stops = getOverviewStops();
    expect(stops.map((s) => s.key)).toEqual(Object.keys(ITINERARY));
    expect(stops.map((s) => s.link)).toEqual(Object.keys(ITINERARY).map((k) => `${k}.html`));
    expect(stops.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps the original marker colours and short dates', () => {
    const stops = getOverviewStops();
    expect(stops.map((s) => s.color)).toEqual(OLD_PALETTE);
    expect(stops[0]).toMatchObject({ name: 'Tokyo', dates: '22 Feb – 1 Mar' });
    expect(stops[7]).toMatchObject({ name: 'Tokyo', dates: '22–23 Mar' });
  });

  it('gives the return visit to Tokyo its own accessible label and a non-overlapping marker', () => {
    const stops = getOverviewStops();
    expect(stops[7]!.label).toBe('Tokyo (return)');
    expect(stops[7]!.coords).not.toEqual(stops[0]!.coords);
    expect(new Set(stops.map((s) => s.label)).size).toBe(stops.length);
  });
});

describe('initOverviewMap', () => {
  let mapEl: HTMLDivElement;
  let list: HTMLElement;

  beforeEach(() => {
    // jsdom has no SVGRect, so Leaflet detects neither SVG nor canvas support and
    // cannot pick a renderer for the route line; jsdom does create SVG elements.
    (L.Browser as { svg: boolean }).svg = true;
    document.documentElement.setAttribute('data-theme', 'light');
    document.body.innerHTML = `
      <div id="map" data-city="overview"></div>
      <div class="cities-grid" id="overview-cities">
        ${getOverviewStops().map((s) => `<a class="city-card" href="${s.link}" data-city="${s.key}">${s.name}</a>`).join('')}
      </div>`;
    mapEl = document.getElementById('map') as HTMLDivElement;
    list = document.getElementById('overview-cities')!;
  });
  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
  });

  it('draws 8 numbered, labelled, keyboard-focusable markers at the original view', () => {
    const overview = initOverviewMap(mapEl, list);
    const icons = [...mapEl.querySelectorAll<HTMLElement>('.leaflet-marker-icon')];
    expect(icons).toHaveLength(8);
    expect(icons.map((i) => i.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    for (const icon of icons) {
      expect(icon.getAttribute('tabindex')).toBe('0');
      expect(icon.getAttribute('role')).toBe('button');
      expect(icon.getAttribute('aria-label')).toMatch(/^\d\. .+, .+ – show details$/);
    }
    expect(icons[7]!.getAttribute('aria-label')).toContain('Tokyo (return)');
    expect(overview.map.getZoom()).toBe(OVERVIEW_VIEW.zoom);
    expect(overview.map.getCenter()).toMatchObject({ lat: 35.5, lng: 137 });
  });

  it('connects the cities with a dashed route line in itinerary order', () => {
    const overview = initOverviewMap(mapEl, list);
    const latlngs = overview.route.getLatLngs() as L.LatLng[];
    expect(latlngs.map((p) => [p.lat, p.lng])).toEqual(getOverviewStops().map((s) => s.coords));
    expect(overview.route.options).toMatchObject({ weight: 2, opacity: 0.5, dashArray: '8, 8', color: '#0071e3' });
  });

  it('route colour follows the theme', () => {
    const overview = initOverviewMap(mapEl, list);
    document.documentElement.setAttribute('data-theme', 'dark');
    window.dispatchEvent(new CustomEvent('theme-changed'));
    expect(overview.route.options.color).toBe('#0a84ff');
  });

  it('marker popup shows city, dates and a "View itinerary" link to the city page', () => {
    const overview = initOverviewMap(mapEl, list);
    overview.select('kyoto');
    const popup = mapEl.querySelector('.leaflet-popup-content')!;
    expect(popup.querySelector('h4')!.textContent).toBe('Kyoto');
    expect(popup.textContent).toContain('8–13 Mar');
    const link = popup.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('kyoto.html');
    expect(link.textContent).toBe('View itinerary');
  });

  it('selecting a marker highlights the matching list card (and only it)', () => {
    const overview = initOverviewMap(mapEl, list);
    overview.select('osaka');
    const selected = list.querySelectorAll('.city-card.is-selected');
    expect(selected).toHaveLength(1);
    expect((selected[0] as HTMLElement).dataset.city).toBe('osaka');
    expect(selected[0]!.getAttribute('aria-current')).toBe('true');
    overview.select('hakone');
    expect(list.querySelector('[data-city="osaka"]')!.classList.contains('is-selected')).toBe(false);
    expect(list.querySelector('[data-city="osaka"]')!.hasAttribute('aria-current')).toBe(false);
  });

  it('clicking a marker selects it (popup + list highlight)', () => {
    const overview = initOverviewMap(mapEl, list);
    overview.markers.get('nagoya')!.fire('click');
    expect(mapEl.querySelector('.leaflet-popup-content h4')!.textContent).toBe('Nagoya');
    expect(list.querySelector('.is-selected')!.getAttribute('data-city')).toBe('nagoya');
  });

  it('hovering or focusing a list card highlights its marker, without opening a popup', () => {
    const overview = initOverviewMap(mapEl, list);
    const card = list.querySelector<HTMLElement>('[data-city="takayama"]')!;
    card.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const icon = overview.markers.get('takayama')!.getElement()!;
    expect(icon.classList.contains('is-highlighted')).toBe(true);
    expect(mapEl.querySelector('.leaflet-popup')).toBeNull();
    card.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(icon.classList.contains('is-highlighted')).toBe(false);
    card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(icon.classList.contains('is-highlighted')).toBe(true);
  });

  it('closing the popup clears the list selection', () => {
    const overview = initOverviewMap(mapEl, list);
    overview.select('kyoto');
    overview.map.closePopup();
    expect(list.querySelector('.is-selected')).toBeNull();
  });

  it('popup links are sanitised (no inline handlers survive)', () => {
    initOverviewMap(mapEl, list).select('tokyo');
    expect(mapEl.querySelector('.leaflet-popup-content [onerror], .leaflet-popup-content script')).toBeNull();
  });
});

describe('observeOverviewMap (lazy init)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('defers initialisation until the map nears the viewport, then runs it once', () => {
    let callback: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) { callback = cb; }
        observe(): void {}
        disconnect = disconnect;
      },
    );
    document.body.innerHTML = '<div id="map"></div>';
    const init = vi.fn();
    observeOverviewMap(document.getElementById('map')!, init);
    expect(init).not.toHaveBeenCalled();
    callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(init).not.toHaveBeenCalled();
    callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(init).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
  });

  it('initialises immediately when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    document.body.innerHTML = '<div id="map"></div>';
    const init = vi.fn();
    observeOverviewMap(document.getElementById('map')!, init);
    expect(init).toHaveBeenCalledTimes(1);
  });
});

describe('landing markup (index.html)', () => {
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');

  it('static "Cities" cards match the overview stops: order, links, numbers, colours, names, dates', () => {
    const cards = [...doc.querySelectorAll<HTMLAnchorElement>('#demo #overview-cities a.city-card')];
    const stops = getOverviewStops();
    expect(cards).toHaveLength(stops.length);
    cards.forEach((card, i) => {
      const stop = stops[i]!;
      expect(card.getAttribute('href')).toBe(stop.link);
      expect(card.dataset.city).toBe(stop.key);
      const marker = card.querySelector<HTMLElement>('.city-marker')!;
      expect(marker.textContent).toBe(String(stop.number));
      expect(marker.getAttribute('style')).toContain(stop.color);
      expect(marker.getAttribute('aria-hidden')).toBe('true');
      expect(card.querySelector('strong')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(stop.label);
      expect(card.querySelector('small')!.textContent).toBe(stop.dates);
    });
  });

  it('map sits above the cards inside #demo, after the countdown', () => {
    const iCountdown = html.indexOf('id="demo-countdown"');
    const iMap = html.indexOf('id="map"');
    const iCards = html.indexOf('id="overview-cities"');
    expect(iCountdown).toBeGreaterThan(html.indexOf('id="demo"'));
    expect(iMap).toBeGreaterThan(iCountdown);
    expect(iCards).toBeGreaterThan(iMap);
  });
});
