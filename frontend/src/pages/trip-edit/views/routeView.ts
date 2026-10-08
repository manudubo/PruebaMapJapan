/**
 * Step 2, part 1 — the route: search a place to add a destination, see the
 * numbered list (the same numbers and colours as the map), reorder, open one.
 */

import { cleanText, dayColor, placeNameFromMapsUrl, routeStops, shortRange, type EDest } from '../model';
import { createPlaceBox } from '../ui/placeBox';
import { h, icon, announce } from '../ui/h';
import { reconcile, byKey } from '../ui/reconcile';
import { makeSortable } from '../ui/sortable';
import type { MountedView, ViewCtx } from './types';

function placesIn(dest: EDest): number {
  return dest.days.reduce((n, d) => n + d.activities.length, 0);
}

export function mountRouteView(ctx: ViewCtx): MountedView {
  const { store } = ctx;

  const box = createPlaceBox({
    label: 'Add a destination',
    placeholder: 'Search a city, e.g. Kyoto',
    hint: 'Each city becomes a numbered stop on the map. You can also paste a Google Maps link.',
    search: ctx.createSearch(),
    inputId: 'dest-search',
    onPlace: (place) => {
      const dest = store.addDestination(place);
      announce(`Added ${dest.city_name} as stop ${store.trip.destinations.length}`);
      requestAnimationFrame(() => byKey(list, dest._key)?.scrollIntoView?.({ block: 'nearest' }));
    },
    onLink: (pt, url) => {
      // A pasted link has coordinates; its /place/<Name>/ segment, when present, is the city name.
      const dest = store.addDestination({ name: placeNameFromMapsUrl(url, 'New destination'), country: '', lat: pt.lat, lng: pt.lng });
      announce(`Added ${dest.city_name} from the link`);
    },
    onFreeText: (text) => {
      store.addDestination({ name: cleanText(text).slice(0, 255), country: '', lat: null, lng: null });
      announce(`Added ${text} without a map location`);
    },
    freeTextLabel: (t) => `Add “${t}” without a map location`,
  });

  const list = h('ul', { class: 'te-dest-list', id: 'destinations-list', attrs: { 'aria-label': 'Destinations in visiting order' } });
  const empty = h('div', { class: 'te-empty', id: 'destinations-empty' },
    h('h3', { text: 'Where does your trip start?' }),
    h('p', { text: 'Search for the first city above. Every city you add becomes a numbered stop on the map, joined by a dashed route, just like the Japan 2026 demo.' }),
  );
  const next = h('button', { type: 'button', class: 'btn btn-secondary te-next', id: 'route-next', on: { click: () => ctx.go({ step: 'share' }) } }, 'Review and share');

  function build(dest: EDest): HTMLElement {
    const grip = h('button', { type: 'button', class: 'te-grip', attrs: { 'data-role': 'grip' } }, icon('grip', 18));
    const open = h('button', { type: 'button', class: 'te-dest-open', attrs: { 'data-role': 'open' } },
      h('strong', { class: 'te-dest-name' }), h('small', { class: 'te-dest-meta' }));
    const up = h('button', { type: 'button', class: 'btn btn-secondary btn-icon te-icon-btn', title: 'Move up', attrs: { 'data-role': 'up' } }, icon('up', 16));
    const down = h('button', { type: 'button', class: 'btn btn-secondary btn-icon te-icon-btn', title: 'Move down', attrs: { 'data-role': 'down' } }, icon('down', 16));
    const del = h('button', { type: 'button', class: 'btn btn-danger btn-icon te-icon-btn', title: 'Delete destination', attrs: { 'data-role': 'delete' } }, icon('trash', 16));
    const li = h('li', { class: 'te-dest' },
      grip,
      h('span', { class: 'te-num', attrs: { 'aria-hidden': 'true' } }),
      open,
      h('div', { class: 'te-row-actions' }, up, down, del),
    );
    open.addEventListener('click', () => ctx.go({ step: 'city', destKey: dest._key, date: null }));
    up.addEventListener('click', () => move(dest._key, -1));
    down.addEventListener('click', () => move(dest._key, 1));
    del.addEventListener('click', () => {
      store.removeDestination(dest._key);
      announce(`Deleted ${dest.city_name}. Undo is available.`);
      box.focus();
    });
    return li;
  }

  function move(key: string, delta: number): void {
    const i = store.trip.destinations.findIndex((d) => d._key === key);
    if (i < 0) return;
    const to = i + delta;
    if (to < 0 || to >= store.trip.destinations.length) return;
    store.moveDestination(key, to);
    const dest = store.dest(key);
    if (dest) announce(`${dest.city_name} moved to position ${to + 1} of ${store.trip.destinations.length}`);
    restoreFocus(key, delta === 0 ? 'grip' : delta < 0 ? 'up' : 'down');
  }

  function restoreFocus(key: string, role: string): void {
    requestAnimationFrame(() => {
      const row = byKey(list, key);
      const target = row?.querySelector<HTMLElement>(`[data-role="${role}"]:not(:disabled)`) ?? row?.querySelector<HTMLElement>('[data-role="grip"]');
      target?.focus();
    });
  }

  function render(): void {
    const dests = store.trip.destinations;
    const stops = routeStops(store.trip);
    empty.hidden = dests.length > 0;
    list.hidden = dests.length === 0;
    next.hidden = dests.length === 0;
    reconcile(list, dests, (d) => d._key, build);
    dests.forEach((d, i) => {
      const li = byKey(list, d._key);
      if (!li) return;
      const stop = stops[i]!;
      const num = li.querySelector<HTMLElement>('.te-num')!;
      num.textContent = String(i + 1);
      num.style.setProperty('background', dayColor(i));
      li.querySelector('.te-dest-name')!.textContent = d.city_name;
      const places = placesIn(d);
      const parts = [d.country, shortRange(d.start_date, d.end_date) || 'Add dates', `${places} place${places === 1 ? '' : 's'}`];
      if (!stop.coords) parts.push('not on the map');
      li.querySelector('.te-dest-meta')!.textContent = parts.filter(Boolean).join(' · ');
      const open = li.querySelector<HTMLElement>('[data-role="open"]')!;
      open.setAttribute('aria-label', `${i + 1}. ${d.city_name}. Plan this stop`);
      li.querySelector<HTMLButtonElement>('[data-role="up"]')!.disabled = i === 0;
      li.querySelector<HTMLButtonElement>('[data-role="down"]')!.disabled = i === dests.length - 1;
      li.querySelector<HTMLElement>('[data-role="grip"]')!.setAttribute('aria-label', `Reorder ${d.city_name}. Use the arrow keys, or drag.`);
      li.querySelector<HTMLElement>('[data-role="delete"]')!.setAttribute('aria-label', `Delete ${d.city_name}`);
    });
  }

  const stopSort = makeSortable(list, {
    handle: '[data-role="grip"]',
    onMove: (from, to) => {
      const dest = store.trip.destinations[from];
      if (!dest) return;
      store.moveDestination(dest._key, to);
      announce(`${dest.city_name} moved to position ${to + 1} of ${store.trip.destinations.length}`);
      restoreFocus(dest._key, 'grip');
    },
  });

  const el = h('div', { class: 'te-view te-route' },
    h('h2', { class: 'te-h2', text: 'Your route' }),
    box.el,
    empty,
    list,
    next,
  );
  render();

  return {
    el,
    update(event) { if (event.kind !== 'trip') render(); },
    destroy() { stopSort(); },
  };
}
