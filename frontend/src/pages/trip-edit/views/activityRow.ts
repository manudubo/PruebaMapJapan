/**
 * One place in a day: the card the user edits. Name and time are always
 * visible (that is what the demo shows); notes, the alternative / general-area
 * flags, the Google Maps link and the pin live under "Details".
 */

import { toCoords } from '@/modules/tripAdapter';
import { cleanText, googleMapsPointUrl, roundCoord, validateActivityFields, isValid, LIMITS, type EActivity } from '../model';
import { field, checkbox, type Field } from '../ui/fields';
import { h, icon, announce, uid } from '../ui/h';
import { createPlaceBox } from '../ui/placeBox';
import type { ViewCtx } from './types';

export interface RowInfo {
  act: EActivity;
  index: number;
  count: number;
  /** Marker text: "1", "2"… or the option letter. */
  label: string;
  color: string;
}

interface Details {
  root: HTMLElement;
  notes: HTMLTextAreaElement;
  optional: HTMLInputElement;
  generic: HTMLInputElement;
  mapsUrl: HTMLInputElement;
  mapsField: Field<HTMLInputElement>;
  pinLine: HTMLElement;
  useLink: HTMLButtonElement;
  clearPin: HTMLButtonElement;
}

const ROLE = 'data-role';

export function buildActivityRow(ctx: ViewCtx, actKey: string): HTMLElement {
  const { store } = ctx;
  const q = (): EActivity | null => store.locate(actKey)?.act ?? null;

  const num = h('button', { type: 'button', class: 'te-num te-num-btn', attrs: { [ROLE]: 'num' } });
  const grip = h('button', { type: 'button', class: 'te-grip', attrs: { [ROLE]: 'grip' } }, icon('grip', 18));
  const name = h('input', { type: 'text', class: 'te-act-name', maxLength: LIMITS.activityName, autocomplete: 'off', attrs: { [ROLE]: 'name', 'aria-label': 'Place name' } });
  const time = h('input', { type: 'time', class: 'te-act-time', attrs: { [ROLE]: 'time', 'aria-label': 'Time (optional)' } });
  const nameError = h('p', { class: 'field-error', hidden: true, attrs: { role: 'alert', [ROLE]: 'name-error' } });
  const tags = h('span', { class: 'te-tags', attrs: { [ROLE]: 'tags' } });
  const toggle = h('button', { type: 'button', class: 'btn btn-secondary btn-small te-details-btn', attrs: { [ROLE]: 'toggle', 'aria-expanded': 'false' } }, 'Details');
  const up = h('button', { type: 'button', class: 'btn btn-secondary btn-icon te-icon-btn', title: 'Move up', attrs: { [ROLE]: 'up' } }, icon('up', 16));
  const down = h('button', { type: 'button', class: 'btn btn-secondary btn-icon te-icon-btn', title: 'Move down', attrs: { [ROLE]: 'down' } }, icon('down', 16));
  const del = h('button', { type: 'button', class: 'btn btn-danger btn-icon te-icon-btn', title: 'Delete place', attrs: { [ROLE]: 'delete' } }, icon('trash', 16));
  const detailsHost = h('div', { class: 'te-act-details', hidden: true });

  const li = h('li', { class: 'te-act' },
    h('div', { class: 'te-act-main' }, grip, num, name, time),
    nameError,
    h('div', { class: 'te-act-sub' }, tags, h('div', { class: 'te-row-actions' }, toggle, up, down, del)),
    detailsHost,
  );

  let details: Details | null = null;

  // ---- name / time ---------------------------------------------------------
  name.addEventListener('input', () => {
    const value = cleanText(name.value);
    const errors = validateActivityFields({ name: value, time: null, maps_url: null });
    nameError.textContent = errors.name ?? '';
    nameError.hidden = !errors.name;
    if (errors.name) name.setAttribute('aria-invalid', 'true'); else name.removeAttribute('aria-invalid');
    if (!errors.name) store.patchActivity(actKey, { name: value.trim() });
  });
  name.addEventListener('blur', () => {
    const act = q();
    if (!act) return;
    if (!name.value.trim()) {
      name.value = act.name;
      nameError.hidden = true;
      name.removeAttribute('aria-invalid');
    }
  });
  time.addEventListener('change', () => {
    const errors = validateActivityFields({ name: 'x', time: time.value || null, maps_url: null });
    if (errors.time) return;
    store.patchActivity(actKey, { time: time.value || null });
  });

  // ---- buttons ---------------------------------------------------------------
  const move = (delta: number): void => {
    const loc = store.locate(actKey);
    if (!loc?.day || !loc.act) return;
    const i = loc.day.activities.indexOf(loc.act);
    const to = i + delta;
    if (to < 0 || to >= loc.day.activities.length) return;
    store.moveActivity(actKey, to);
    announce(`${loc.act.name} moved to position ${to + 1} of ${loc.day.activities.length}`);
    requestAnimationFrame(() => {
      const row = li.isConnected ? li : null;
      (row?.querySelector<HTMLElement>(`[${ROLE}="${delta < 0 ? 'up' : 'down'}"]:not(:disabled)`) ?? row?.querySelector<HTMLElement>(`[${ROLE}="grip"]`))?.focus();
    });
  };
  up.addEventListener('click', () => move(-1));
  down.addEventListener('click', () => move(1));
  del.addEventListener('click', () => {
    const act = q();
    const next = (li.nextElementSibling ?? li.previousElementSibling) as HTMLElement | null;
    store.removeActivity(actKey);
    if (act) announce(`Deleted ${act.name}. Undo is available.`);
    (next?.querySelector<HTMLElement>(`[${ROLE}="name"]`))?.focus();
  });
  num.addEventListener('click', () => ctx.focusOnMap(actKey));
  toggle.addEventListener('click', () => {
    const open = detailsHost.hidden;
    if (open && !details) { details = buildDetails(); detailsHost.append(details.root); }
    detailsHost.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    const act = q();
    if (open && act) syncDetails(act);
  });

  li.addEventListener('mouseenter', () => ctx.highlight(actKey));
  li.addEventListener('mouseleave', () => ctx.highlight(null));
  li.addEventListener('focusin', () => ctx.highlight(actKey));
  li.addEventListener('focusout', (e) => { if (!li.contains((e as FocusEvent).relatedTarget as Node | null)) ctx.highlight(null); });

  // ---- details -----------------------------------------------------------------
  function buildDetails(): Details {
    const notes = h('textarea', { rows: 3, id: uid('notes'), placeholder: 'Opening hours, what to order, how to get there…', attrs: { [ROLE]: 'notes' } });
    const notesField = field('Notes', notes);
    const optional = checkbox(uid('opt'), 'Alternative option', 'Shown as Option A, B… on the map: one of several choices for the day.');
    const generic = checkbox(uid('gen'), 'General area, not an exact spot', 'For neighbourhoods or free time: no directions link is shown.');
    const mapsUrl = h('input', { type: 'url', id: uid('maps'), placeholder: 'https://maps.app.goo.gl/…', attrs: { [ROLE]: 'maps-url' } });
    const mapsField = field('Google Maps link', mapsUrl, { hint: 'What “View on Maps” opens. Empty: the pin location is used.' });
    const useLink = h('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Use the pin as the link', attrs: { [ROLE]: 'use-link' } });
    const pinLine = h('p', { class: 'te-pin-line', attrs: { [ROLE]: 'pin-line' } });
    const clearPin = h('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Remove pin', attrs: { [ROLE]: 'clear-pin' } });
    const change = createPlaceBox({
      label: 'Change location',
      placeholder: 'Search to move this pin',
      search: ctx.createSearch(),
      onPlace: (p) => { store.patchActivity(actKey, { lat: p.lat, lng: p.lng }, true); announce('Location updated'); },
      onLink: (pt, url) => {
        store.patchActivity(actKey, { lat: pt.lat, lng: pt.lng, ...(mapsUrl.value.trim() ? {} : { maps_url: url }) }, true);
        announce('Location updated from the link');
      },
    });

    notes.addEventListener('input', () => store.patchActivity(actKey, { notes: cleanText(notes.value).trim() || null }));
    optional.input.addEventListener('change', () => store.patchActivity(actKey, { is_optional: optional.input.checked }, true));
    generic.input.addEventListener('change', () => store.patchActivity(actKey, { is_generic: generic.input.checked }, true));
    mapsUrl.addEventListener('input', () => {
      const errors = validateActivityFields({ name: 'x', time: null, maps_url: mapsUrl.value });
      mapsField.setError(errors.maps_url ?? null);
      if (isValid({ u: errors.maps_url })) store.patchActivity(actKey, { maps_url: mapsUrl.value.trim() || null });
    });
    useLink.addEventListener('click', () => {
      const act = q();
      const c = act ? toCoords(act.lat, act.lng) : undefined;
      if (!c) return;
      const url = googleMapsPointUrl(c[0], c[1]);
      mapsUrl.value = url;
      mapsField.setError(null);
      store.patchActivity(actKey, { maps_url: url }, true);
      announce('Google Maps link filled in');
    });
    clearPin.addEventListener('click', () => store.patchActivity(actKey, { lat: null, lng: null }, true));

    const root = h('div', { class: 'te-details-body' },
      notesField.el,
      h('div', { class: 'te-checks' }, optional.el, generic.el),
      mapsField.el,
      h('div', { class: 'te-pin-row' }, pinLine, useLink, clearPin),
      change.el,
    );
    return { root, notes, optional: optional.input, generic: generic.input, mapsUrl, mapsField, pinLine, useLink, clearPin };
  }

  function syncDetails(act: EActivity): void {
    if (!details) return;
    const d = details;
    const active = document.activeElement;
    if (active !== d.notes) d.notes.value = act.notes ?? '';
    d.optional.checked = act.is_optional;
    d.generic.checked = act.is_generic;
    if (active !== d.mapsUrl) d.mapsUrl.value = act.maps_url ?? '';
    const c = toCoords(act.lat, act.lng);
    d.pinLine.textContent = c ? `Pin at ${roundCoord(c[0])}, ${roundCoord(c[1])}` : 'No pin yet: search above or click the map.';
    d.useLink.hidden = !c;
    d.clearPin.hidden = !c;
  }

  // Exposed for updateActivityRow.
  (li as HTMLElement & { __sync?: (a: EActivity) => void }).__sync = syncDetails;
  return li;
}

export function updateActivityRow(li: HTMLElement, info: RowInfo): void {
  const { act, index, count, label, color } = info;
  const get = <T extends HTMLElement>(role: string): T => li.querySelector<T>(`[${ROLE}="${role}"]`)!;
  const active = document.activeElement;

  const num = get<HTMLButtonElement>('num');
  num.textContent = label;
  num.style.setProperty('background', act.is_optional ? '#af52de' : color);
  num.classList.toggle('optional', act.is_optional);
  const located = !!toCoords(act.lat, act.lng);
  num.disabled = !located;
  num.classList.toggle('is-unlocated', !located && !act.is_generic);
  num.title = located ? 'Show on the map' : 'No map location';
  num.setAttribute('aria-label', located ? `${label}. Show ${act.name} on the map` : `${label}. ${act.name} has no map location`);

  const name = get<HTMLInputElement>('name');
  if (active !== name) name.value = act.name;
  const time = get<HTMLInputElement>('time');
  if (active !== time) time.value = act.time ? act.time.slice(0, 5) : '';

  get<HTMLButtonElement>('up').disabled = index === 0;
  get<HTMLButtonElement>('down').disabled = index === count - 1;
  get<HTMLElement>('up').setAttribute('aria-label', `Move ${act.name} up`);
  get<HTMLElement>('down').setAttribute('aria-label', `Move ${act.name} down`);
  get<HTMLElement>('delete').setAttribute('aria-label', `Delete ${act.name}`);
  get<HTMLElement>('grip').setAttribute('aria-label', `Reorder ${act.name}. Use the arrow keys, or drag.`);
  get<HTMLElement>('toggle').setAttribute('aria-label', `Details for ${act.name}`);

  const tags = get<HTMLElement>('tags');
  tags.replaceChildren();
  if (act.is_optional) tags.append(h('span', { class: 'te-tag te-tag--option', text: `Option ${label}` }));
  if (act.is_generic) tags.append(h('span', { class: 'te-tag', text: 'General area' }));
  else if (!located) tags.append(h('span', { class: 'te-tag te-tag--warn', text: 'No map location' }));
  if (act.notes) tags.append(h('span', { class: 'te-tag', text: 'Note' }));

  (li as HTMLElement & { __sync?: (a: EActivity) => void }).__sync?.(act);
}
