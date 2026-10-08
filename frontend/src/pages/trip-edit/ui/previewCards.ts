/**
 * The demo-style cards under the live map: the "Cities" grid on the route, and
 * the day selector + day legend + hotel row inside a city. Same classes as the
 * landing demo and the city pages, so the preview *is* what the trip will look
 * like. Read-only; clicking a card/item only moves the selection.
 */

import { h, icon, append } from './h';
import { reconcile, byKey } from './reconcile';
import type { RouteStop } from '../model';
import type { CityPreview, PreviewGroup, PreviewItem } from '../previewModel';

export interface CardsHandlers {
  onOpenCity: (destKey: string) => void;
  /** null = "All days". */
  onSelectDate: (date: string | null) => void;
  onFocusItem: (itemKey: string) => void;
}

export interface RouteCardsState {
  stops: RouteStop[];
  selectedKey: string | null;
  summary: string;
}

export interface CityCardsState {
  city: CityPreview;
  groups: PreviewGroup[];
  activeDate: string | null;
  showAll: boolean;
}

function ensureShell(host: HTMLElement, mode: 'route' | 'city', build: () => void): boolean {
  if (host.dataset['mode'] === mode) return false;
  host.dataset['mode'] = mode;
  host.replaceChildren();
  build();
  return true;
}

// ---------------------------------------------------------------------------
// Route: "Cities"
// ---------------------------------------------------------------------------

export function renderRouteCards(host: HTMLElement, state: RouteCardsState, handlers: CardsHandlers): void {
  ensureShell(host, 'route', () => {
    host.append(
      h('section', { class: 'quick-links te-cities', attrs: { 'aria-labelledby': 'te-cities-title' } },
        h('h3', { id: 'te-cities-title', text: 'Cities' }),
        h('p', { class: 'te-summary', id: 'te-route-summary' }),
        h('div', { class: 'cities-grid', id: 'te-cities-grid' }),
        h('p', { class: 'te-preview-empty', id: 'te-cities-empty', text: 'Your cities will appear here, numbered in visiting order, just like the Japan 2026 demo.' }),
      ),
    );
    host.querySelector('#te-cities-grid')!.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
      if (card?.dataset['key']) handlers.onOpenCity(card.dataset['key']);
    });
  });
  const grid = host.querySelector<HTMLElement>('#te-cities-grid')!;
  host.querySelector<HTMLElement>('#te-route-summary')!.textContent = state.summary;
  host.querySelector<HTMLElement>('#te-cities-empty')!.hidden = state.stops.length > 0;
  grid.hidden = state.stops.length === 0;

  reconcile(grid, state.stops, (s) => s.key, (s) => {
    const marker = h('span', { class: 'city-marker', attrs: { 'aria-hidden': 'true' } });
    return h('button', { type: 'button', class: 'city-card', attrs: { 'data-city': s.destId } },
      marker, h('div', { class: 'city-info' }, h('strong'), h('small')));
  }, undefined);
  // Update contents of every card (cheap; also covers newly created ones).
  for (const stop of state.stops) {
    const card = byKey(grid, stop.key);
    if (!card) continue;
    const marker = card.querySelector<HTMLElement>('.city-marker')!;
    marker.textContent = String(stop.number);
    marker.style.setProperty('background', stop.color);
    card.querySelector('strong')!.textContent = stop.label;
    card.querySelector('small')!.textContent = stop.dates || 'No dates yet';
    card.classList.toggle('is-selected', stop.key === state.selectedKey);
    card.setAttribute('aria-label', `${stop.number}. ${stop.label}${stop.dates ? `, ${stop.dates}` : ''}. Open`);
  }
}

// ---------------------------------------------------------------------------
// City: day selector + legend + hotel
// ---------------------------------------------------------------------------

function legendItem(): HTMLElement {
  return h('li', { class: 'legend-item' },
    h('div', { class: 'legend-marker' }),
    h('div', { class: 'legend-content' }, h('strong'), h('span', { class: 'legend-time' }), h('small')),
    h('div', { class: 'legend-actions' }),
  );
}

function updateLegendItem(el: HTMLElement, item: PreviewItem, color: string, onFocus: (key: string) => void): void {
  el.classList.toggle('is-optional', item.optional);
  const marker = el.querySelector<HTMLElement>('.legend-marker')!;
  marker.textContent = item.label;
  marker.style.setProperty('background', item.optional ? '#af52de' : color);
  el.querySelector('strong')!.textContent = item.name;
  const time = el.querySelector<HTMLElement>('.legend-time')!;
  time.textContent = item.time ?? '';
  time.hidden = !item.time;
  const small = el.querySelector<HTMLElement>('small')!;
  const note = item.notes ? (item.notes.length > 50 ? `${item.notes.slice(0, 50)}...` : item.notes) : item.generic ? 'General area' : item.coords ? '' : 'No map location yet';
  small.textContent = note;
  small.hidden = !note;
  const actions = el.querySelector<HTMLElement>('.legend-actions')!;
  actions.replaceChildren(
    ...(item.mapsUrl ? [h('a', { href: item.mapsUrl, target: '_blank', rel: 'noopener', class: 'legend-action-btn', title: 'View on Google Maps', attrs: { 'aria-label': `View ${item.name} on Google Maps` } }, icon('maps', 16))] : []),
    ...(item.directionsUrl ? [h('a', { href: item.directionsUrl, target: '_blank', rel: 'noopener', class: 'legend-action-btn directions', title: 'Directions', attrs: { 'aria-label': `Directions to ${item.name}` } }, icon('nav', 16))] : []),
  );
  el.onclick = (e) => {
    if ((e.target as HTMLElement).closest('a')) return;
    if (item.coords) onFocus(item.key);
  };
}

export function renderCityCards(host: HTMLElement, state: CityCardsState, handlers: CardsHandlers): void {
  ensureShell(host, 'city', () => {
    host.append(
      h('div', { class: 'day-selector te-day-selector', id: 'te-preview-days', attrs: { role: 'group', 'aria-label': 'Filter the preview by day' } }),
      h('section', { class: 'legend te-legend', attrs: { 'aria-label': 'Activity legend' } },
        h('h2', { id: 'te-legend-title' }),
        h('div', { class: 'legend-grid', id: 'te-legend-grid' }),
        h('p', { class: 'te-preview-empty', id: 'te-legend-empty', text: 'Places you add show up here as the day-by-day list, like the city pages in the demo.' }),
        h('div', { class: 'hotel-info', id: 'te-hotel-info', hidden: true }),
      ),
    );
    host.querySelector('#te-preview-days')!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-day]');
      if (!btn) return;
      const v = btn.dataset['day']!;
      handlers.onSelectDate(v === '*' ? null : v);
    });
  });

  const days = host.querySelector<HTMLElement>('#te-preview-days')!;
  type Opt = { key: string; label: string; active: boolean; hasOptions: boolean };
  const opts: Opt[] = [
    { key: '*', label: 'All days', active: state.showAll, hasOptions: false },
    ...state.city.chips.map((c) => ({
      key: c.date,
      label: c.label,
      active: !state.showAll && c.date === state.activeDate,
      hasOptions: state.city.groups.some((g) => g.date === c.date && g.hasOptions),
    })),
  ];
  days.hidden = state.city.chips.length === 0;
  reconcile(days, opts, (o) => o.key, (o) => h('button', { type: 'button', class: 'day-btn', attrs: { 'data-day': o.key } }),
    undefined);
  for (const o of opts) {
    const btn = byKey(days, o.key);
    if (!btn) continue;
    btn.textContent = o.label;
    btn.classList.toggle('active', o.active);
    btn.classList.toggle('has-options', o.hasOptions);
    btn.setAttribute('aria-pressed', String(o.active));
  }

  host.querySelector<HTMLElement>('#te-legend-title')!.textContent = `${state.city.name} · Activities`;
  const grid = host.querySelector<HTMLElement>('#te-legend-grid')!;
  grid.hidden = state.groups.length === 0;
  host.querySelector<HTMLElement>('#te-legend-empty')!.hidden = state.groups.length > 0;

  reconcile(grid, state.groups, (g) => g.key, (g) => {
    const list = h('ul', { class: 'day-activities', attrs: { role: 'list' } });
    return h('div', { class: 'day-group', attrs: { 'data-day': g.date } },
      h('div', { class: 'day-group-header' }, h('div', { class: 'day-group-color' }), h('span', { class: 'day-group-label' }), h('span', { class: 'day-group-badge', text: 'Options', hidden: true })),
      list);
  });
  for (const g of state.groups) {
    const el = byKey(grid, g.key);
    if (!el) continue;
    el.classList.toggle('has-options', g.hasOptions);
    el.querySelector<HTMLElement>('.day-group-color')!.style.setProperty('background', g.color);
    el.querySelector('.day-group-label')!.textContent = g.label;
    el.querySelector<HTMLElement>('.day-group-badge')!.hidden = !g.hasOptions;
    const list = el.querySelector<HTMLElement>('.day-activities')!;
    reconcile(list, g.items, (i) => i.key, () => legendItem());
    for (const item of g.items) {
      const li = byKey(list, item.key);
      if (li) updateLegendItem(li, item, g.color, handlers.onFocusItem);
    }
  }

  const hotel = host.querySelector<HTMLElement>('#te-hotel-info')!;
  const hot = state.city.hotel;
  hotel.hidden = !hot;
  if (hot) {
    hotel.replaceChildren();
    append(hotel, [
      h('div', { class: 'marker', text: 'H' }),
      h('span', { text: hot.name }),
      hot.mapsUrl || hot.directionsUrl
        ? h('div', { class: 'legend-actions' },
            hot.mapsUrl ? h('a', { href: hot.mapsUrl, target: '_blank', rel: 'noopener', class: 'legend-action-btn', title: 'View on Google Maps', attrs: { 'aria-label': `View ${hot.name} on Google Maps` } }, icon('maps', 16)) : null,
            hot.directionsUrl ? h('a', { href: hot.directionsUrl, target: '_blank', rel: 'noopener', class: 'legend-action-btn directions', title: 'Directions', attrs: { 'aria-label': `Directions to ${hot.name}` } }, icon('nav', 16)) : null)
        : null,
    ]);
  }
}
