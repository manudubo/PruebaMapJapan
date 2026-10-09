/**
 * Step 2, part 2 — one city: its dates, the day chips, the places of the
 * selected day (add by search, by pasted link or by dropping a pin; drag to
 * order; flag alternatives and general areas) and the hotel.
 */

import { toCoords } from '@/modules/tripAdapter';
import {
  cleanText, dayChips, dayColor, isValid, validateDestinationFields, placeNameFromMapsUrl, validateHttpUrl,
  LIMITS, type DayChip, type EDest,
} from '../model';
import { markerLabels } from '../previewModel';
import { field } from '../ui/fields';
import { h, icon, announce, append } from '../ui/h';
import { createPlaceBox } from '../ui/placeBox';
import { reconcile, byKey } from '../ui/reconcile';
import { makeSortable } from '../ui/sortable';
import { buildActivityRow, updateActivityRow } from './activityRow';
import type { MountedView, ViewCtx } from './types';

export function mountCityView(ctx: ViewCtx, destKey: string, initialDate: string | null): MountedView {
  const { store } = ctx;
  let dest: EDest | undefined = store.dest(destKey);

  if (!dest) {
    const gone = h('div', { class: 'te-view' }, h('p', { class: 'te-empty', text: 'This destination is no longer in the trip.' }),
      h('button', { type: 'button', class: 'btn btn-secondary', on: { click: () => ctx.go({ step: 'route' }) } }, 'Back to destinations'));
    return { el: gone, update() {}, destroy() {} };
  }

  const initialChips = dayChips(dest);
  let date: string | null = initialDate && initialChips.some((c) => c.date === initialDate)
    ? initialDate
    : (initialChips.find((c) => c.activityCount > 0) ?? initialChips[0])?.date ?? null;

  // ---- header + details ---------------------------------------------------------
  const back = h('button', { type: 'button', class: 'te-back-btn', id: 'city-back', on: { click: () => { ctx.pickOnMap(null); ctx.go({ step: 'route' }); } } }, icon('back', 18), 'All destinations');
  const title = h('h2', { class: 'te-h2 te-city-title', id: 'city-title' });
  const subtitle = h('p', { class: 'te-city-sub', id: 'city-subtitle' });

  const cityInput = h('input', { type: 'text', id: 'dest-city', maxLength: LIMITS.city, autocomplete: 'off' });
  const countryInput = h('input', { type: 'text', id: 'dest-country', maxLength: LIMITS.country, autocomplete: 'off' });
  const zoomInput = h('input', { type: 'range', id: 'dest-zoom', min: '1', max: '19', step: '1' });
  const zoomOut = h('output', { class: 'te-zoom-out', htmlFor: 'dest-zoom' });
  const fCity = field('City', cityInput);
  const fCountry = field('Country', countryInput);
  const moveCity = createPlaceBox({
    label: 'Move the city pin', placeholder: 'Search to relocate this city on the map', search: ctx.createSearch(), inputId: 'dest-relocate',
    onPlace: (p) => { store.patchDestination(destKey, { lat: p.lat, lng: p.lng }, true); announce('City location updated'); },
    onLink: (pt) => { store.patchDestination(destKey, { lat: pt.lat, lng: pt.lng }, true); announce('City location updated'); },
  });
  const cityDetails = h('details', { class: 'te-more', id: 'city-details' },
    h('summary', { text: 'City details' }),
    h('div', { class: 'form-row' }, fCity.el, fCountry.el),
    h('div', { class: 'form-group' }, h('label', { htmlFor: 'dest-zoom', text: 'Map zoom' }), h('div', { class: 'range-row' }, zoomInput, zoomOut),
      h('p', { class: 'form-hint', text: 'Lower shows a wider region, higher shows streets. Big cities: 11–12; small towns: 13–14.' })),
    moveCity.el,
  );

  const startInput = h('input', { type: 'date', id: 'dest-start' });
  const endInput = h('input', { type: 'date', id: 'dest-end' });
  const fStart = field('Arrival', startInput, { className: 'te-date' });
  const fEnd = field('Departure', endInput, { className: 'te-date' });
  const datesRow = h('div', { class: 'form-row te-dates' }, fStart.el, fEnd.el);

  // ---- days ------------------------------------------------------------------------
  const chipsHost = h('div', { class: 'day-selector te-days', id: 'day-chips', attrs: { role: 'tablist', 'aria-label': 'Days in this city' } });
  const noDates = h('p', { class: 'te-empty te-empty--inline', id: 'no-dates', hidden: true, text: 'Set your arrival and departure above to plan day by day.' });
  const dayTitle = h('h3', { class: 'te-day-title', id: 'day-title' });
  const dayLabelInput = h('input', { type: 'text', id: 'day-label', maxLength: 255, placeholder: 'e.g. Temples and tea' });
  const fDayLabel = field('Day title (optional)', dayLabelInput);
  const dayOptions = h('details', { class: 'te-more', id: 'day-options', hidden: true }, h('summary', { text: 'Day options' }), fDayLabel.el);
  const list = h('ul', { class: 'te-acts', id: 'activity-list', attrs: { 'aria-label': 'Places for this day, in order' } });
  const emptyDay = h('div', { class: 'te-empty', id: 'activities-empty' },
    h('h3', { text: 'Nothing planned for this day yet' }),
    h('p', { text: 'Search for a place below, paste a Google Maps link, or drop a pin on the map. Each one gets a numbered marker in the day’s colour.' }));

  const addBox = createPlaceBox({
    label: 'Add a place', placeholder: 'Search a temple, restaurant, station…', search: ctx.createSearch(), inputId: 'act-search',
    onPlace: (p) => addPlace({ name: p.name, lat: p.lat, lng: p.lng }),
    onLink: (pt, url) => addPlace({ name: placeNameFromMapsUrl(url), lat: pt.lat, lng: pt.lng, maps_url: validateHttpUrl(url) ? null : url }),
    onFreeText: (t) => addPlace({ name: cleanText(t).slice(0, LIMITS.activityName) }),
    freeTextLabel: (t) => `Add “${t}” without a map location`,
  });
  const pickBtn = h('button', { type: 'button', class: 'btn btn-secondary te-pick', id: 'pick-pin', attrs: { 'aria-pressed': 'false' } }, icon('pin', 16), 'Drop a pin on the map');
  const pickHint = h('p', { class: 'te-pick-hint form-hint', id: 'pick-hint', hidden: true, attrs: { role: 'status' }, text: 'Click the map to drop a pin. Press Esc to cancel.' });
  const composer = h('div', { class: 'te-composer', id: 'composer' }, addBox.el, h('div', { class: 'te-composer-or' }, h('span', { text: 'or' })), pickBtn, pickHint);

  // ---- hotel ----------------------------------------------------------------------------
  const hotelHost = h('section', { class: 'te-hotel', id: 'hotel-section', attrs: { 'aria-labelledby': 'hotel-title' } });

  const dayPanel = h('section', { class: 'te-day-panel', id: 'day-panel', attrs: { role: 'tabpanel', 'aria-labelledby': 'day-title' } }, dayTitle, dayOptions, emptyDay, list, composer);

  const el = h('div', { class: 'te-view te-city' },
    back,
    h('header', { class: 'te-city-head' }, title, subtitle),
    datesRow,
    cityDetails,
    chipsHost,
    noDates,
    dayPanel,
    hotelHost,
  );

  // ---- behaviour ---------------------------------------------------------------------------
  function curChips(): DayChip[] { return dest ? dayChips(dest) : []; }
  function chipOf(d: string | null): DayChip | undefined { return curChips().find((c) => c.date === d); }

  function selectDate(next: string | null): void {
    date = next;
    ctx.go({ step: 'city', destKey, date });
    render();
  }

  function addPlace(a: { name: string; lat?: number; lng?: number; maps_url?: string | null }): void {
    if (!date) return;
    const act = store.addActivity(destKey, date, { name: a.name, lat: a.lat ?? null, lng: a.lng ?? null, maps_url: a.maps_url ?? null });
    if (!act) return;
    announce(`Added ${a.name} to ${chipOf(date)?.label ?? 'this day'}`);
    requestAnimationFrame(() => {
      const row = byKey(list, act._key);
      row?.scrollIntoView?.({ block: 'nearest' });
      row?.classList.add('is-new');
      window.setTimeout(() => row?.classList.remove('is-new'), 1200);
    });
    addBox.focus();
  }

  function onPin(lat: number, lng: number): void {
    ctx.pickOnMap(null);
    syncPick();
    if (!date) return;
    const act = store.addActivity(destKey, date, { name: 'Pinned place', lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });
    if (!act) return;
    announce('Pin dropped. Name this place.');
    requestAnimationFrame(() => {
      const row = byKey(list, act._key);
      const input = row?.querySelector<HTMLInputElement>('[data-role="name"]');
      row?.scrollIntoView?.({ block: 'nearest' });
      input?.focus();
      input?.select();
    });
  }

  function syncPick(): void {
    const on = ctx.isPicking();
    pickBtn.setAttribute('aria-pressed', String(on));
    pickBtn.classList.toggle('is-on', on);
    pickHint.hidden = !on;
  }
  pickBtn.addEventListener('click', () => {
    if (ctx.isPicking()) ctx.pickOnMap(null);
    else ctx.pickOnMap(onPin);
    syncPick();
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && ctx.isPicking()) { ctx.pickOnMap(null); syncPick(); }
  };
  document.addEventListener('keydown', onKey);

  // dates + details inputs
  const readDest = (): { city_name: string; country: string; start_date: string | null; end_date: string | null } => ({
    city_name: cleanText(cityInput.value).trim(),
    country: cleanText(countryInput.value).trim(),
    start_date: startInput.value || null,
    end_date: endInput.value || null,
  });
  const onDestInput = (): void => {
    const v = readDest();
    const errors = validateDestinationFields(v);
    fCity.setError(errors.city_name ?? null);
    fCountry.setError(errors.country ?? null);
    fStart.setError(errors.start_date ?? null);
    fEnd.setError(errors.end_date ?? null);
    endInput.min = startInput.value;
    startInput.max = endInput.value;
    if (!isValid(errors)) return;
    store.patchDestination(destKey, { city_name: v.city_name, country: v.country, start_date: v.start_date, end_date: v.end_date });
  };
  for (const input of [cityInput, countryInput, startInput, endInput]) input.addEventListener('input', onDestInput);
  for (const input of [cityInput, countryInput]) {
    input.addEventListener('blur', () => {
      if (dest && !input.value.trim()) { cityInput.value = dest.city_name; countryInput.value = dest.country; onDestInput(); }
    });
  }
  zoomInput.addEventListener('input', () => {
    zoomOut.value = zoomInput.value;
    store.patchDestination(destKey, { zoom_level: Number(zoomInput.value) });
  });
  dayLabelInput.addEventListener('input', () => {
    const d = date ? dest?.days.find((x) => x.date === date) : undefined;
    if (d) store.patchDay(d._key, { label: cleanText(dayLabelInput.value).trim() || null });
  });

  chipsHost.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-date]');
    if (btn?.dataset['date']) selectDate(btn.dataset['date']);
  });
  chipsHost.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const chips = curChips();
    const i = chips.findIndex((c) => c.date === date);
    if (i < 0) return;
    const to = e.key === 'ArrowRight' ? Math.min(chips.length - 1, i + 1) : Math.max(0, i - 1);
    e.preventDefault();
    selectDate(chips[to]!.date);
    requestAnimationFrame(() => byKey(chipsHost, chips[to]!.date)?.focus());
  });

  const stopSort = makeSortable(list, {
    handle: '[data-role="grip"]',
    onMove: (from, to) => {
      const day = date ? dest?.days.find((d) => d.date === date) : undefined;
      const act = day?.activities[from];
      if (!act) return;
      store.moveActivity(act._key, to);
      announce(`${act.name} moved to position ${to + 1} of ${day!.activities.length}`);
      requestAnimationFrame(() => byKey(list, act._key)?.querySelector<HTMLElement>('[data-role="grip"]')?.focus());
    },
  });

  // ---- hotel section ---------------------------------------------------------------------------
  let hotelKey: string | null | undefined;
  function renderHotel(): void {
    if (!dest) return;
    const hotel = dest.hotel ?? null;
    const key = hotel?._key ?? null;
    if (key === hotelKey && hotelHost.childElementCount > 0) {
      const input = hotelHost.querySelector<HTMLInputElement>('#hotel-name');
      if (input && hotel && document.activeElement !== input) input.value = hotel.name;
      return;
    }
    hotelKey = key;
    hotelHost.replaceChildren(h('h3', { class: 'te-h3', id: 'hotel-title', text: 'Hotel' }));
    if (hotel) {
      const nameInput = h('input', { type: 'text', id: 'hotel-name', maxLength: LIMITS.hotelName, value: hotel.name, attrs: { 'aria-label': 'Hotel name' } });
      nameInput.addEventListener('change', () => {
        const v = cleanText(nameInput.value).trim();
        if (!v) { nameInput.value = hotel.name; return; }
        store.setHotel(destKey, { name: v, lat: toCoords(hotel.lat, hotel.lng)?.[0] ?? null, lng: toCoords(hotel.lat, hotel.lng)?.[1] ?? null });
      });
      const where = toCoords(hotel.lat, hotel.lng);
      append(hotelHost, [h('div', { class: 'hotel-info te-hotel-card' },
        h('div', { class: 'marker', text: 'H' }),
        nameInput,
        h('button', { type: 'button', class: 'btn btn-danger btn-small', id: 'hotel-remove', on: { click: () => { store.removeHotel(destKey); announce('Hotel removed. Undo is available.'); } } }, 'Remove'),
      ), where ? null : h('p', { class: 'form-hint', text: 'This hotel has no map location. Search again to pin it.' })]);
    } else {
      const box = createPlaceBox({
        label: 'Where are you staying?', placeholder: 'Search your hotel', search: ctx.createSearch(), inputId: 'hotel-search',
        hint: 'Shown as the orange H on the map. Optional.',
        onPlace: (p) => { store.setHotel(destKey, { name: p.name, lat: p.lat, lng: p.lng }); announce(`Hotel set to ${p.name}`); },
        onLink: (pt, url) => store.setHotel(destKey, { name: placeNameFromMapsUrl(url, 'Hotel'), lat: pt.lat, lng: pt.lng }),
        onFreeText: (t) => store.setHotel(destKey, { name: cleanText(t).slice(0, LIMITS.hotelName), lat: null, lng: null }),
        freeTextLabel: (t) => `Use “${t}” without a map location`,
      });
      hotelHost.append(box.el);
    }
  }

  // ---- render ---------------------------------------------------------------------------------------
  function render(): void {
    dest = store.dest(destKey);
    if (!dest) { ctx.go({ step: 'route' }); return; }
    const d = dest;

    title.textContent = d.city_name;
    subtitle.textContent = d.country;
    const active = document.activeElement;
    if (active !== cityInput) cityInput.value = d.city_name;
    if (active !== countryInput) countryInput.value = d.country;
    if (active !== startInput) startInput.value = d.start_date ?? '';
    if (active !== endInput) endInput.value = d.end_date ?? '';
    endInput.min = startInput.value;
    startInput.max = endInput.value;
    zoomInput.value = String(d.zoom_level ?? 12);
    zoomOut.value = zoomInput.value;

    const chips = dayChips(d);
    if (date && !chips.some((c) => c.date === date)) date = chips.find((c) => c.activityCount > 0)?.date ?? chips[0]?.date ?? null;
    if (!date && chips.length > 0) date = chips[0]!.date;
    const hasChips = chips.length > 0;
    chipsHost.hidden = !hasChips;
    noDates.hidden = hasChips;
    dayPanel.hidden = !hasChips;

    reconcile(chipsHost, chips, (c) => c.date, (c) => h('button', { type: 'button', class: 'day-btn te-day', attrs: { role: 'tab', 'data-date': c.date } }));
    chips.forEach((c) => {
      const btn = byKey(chipsHost, c.date);
      if (!btn) return;
      const on = c.date === date;
      btn.replaceChildren();
      append(btn, [
        h('span', { class: 'te-day-dot', attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'te-day-text', text: c.label }),
        c.activityCount > 0 ? h('span', { class: 'te-day-count', text: String(c.activityCount), attrs: { 'aria-label': `${c.activityCount} place${c.activityCount === 1 ? '' : 's'}` } }) : null,
      ]);
      (btn.querySelector('.te-day-dot') as HTMLElement).style.setProperty('background', c.color);
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      btn.title = c.outOfRange ? `${c.label} (outside this city's dates)` : c.label;
    });

    const chip = chips.find((c) => c.date === date);
    dayTitle.textContent = chip ? `${chip.label} · Day ${chip.number}` : '';
    const day = date ? d.days.find((x) => x.date === date) : undefined;
    const acts = day?.activities ?? [];
    emptyDay.hidden = acts.length > 0;
    list.hidden = acts.length === 0;
    dayOptions.hidden = !day;
    if (day && document.activeElement !== dayLabelInput) dayLabelInput.value = day.label ?? '';

    const labels = markerLabels(acts);
    reconcile(list, acts, (a) => a._key, (a) => buildActivityRow(ctx, a._key));
    acts.forEach((a, i) => {
      const li = byKey(list, a._key);
      if (li) updateActivityRow(li, { act: a, index: i, count: acts.length, label: labels[i]!, color: chip?.color ?? dayColor(0) });
    });

    const label = chip ? `Add a place to ${chip.label}` : 'Add a place';
    addBox.el.querySelector('label')!.textContent = label;
    syncPick();
    renderHotel();
  }

  render();

  return {
    el,
    update(event) { if (event.kind !== 'trip') render(); },
    setDate(next) {
      if (next === date) return;
      date = next;
      render();
    },
    destroy() {
      stopSort();
      document.removeEventListener('keydown', onKey);
      ctx.pickOnMap(null);
    },
  };
}
