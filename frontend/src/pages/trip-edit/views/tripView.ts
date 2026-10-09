/**
 * Step 1 — the trip itself: name and (optional) dates up front; description and
 * cover link tucked under "More options". In new-trip mode it creates the trip;
 * for an existing trip every valid edit autosaves.
 */

import { daysBetween } from '@/modules/dates';
import { cleanText, validateHttpUrl, validateTripFields, isValid, LIMITS } from '../model';
import { h } from '../ui/h';
import { field } from '../ui/fields';
import type { MountedView, ViewCtx } from './types';

export function mountTripView(ctx: ViewCtx): MountedView {
  const { store } = ctx;
  const t = store.trip;

  const name = h('input', { type: 'text', id: 'trip-name', name: 'name', required: true, maxLength: LIMITS.tripName, autocomplete: 'off', placeholder: 'e.g. Japan 2026', value: t.name });
  const start = h('input', { type: 'date', id: 'trip-start-date', name: 'start_date', value: t.start_date ?? '' });
  const end = h('input', { type: 'date', id: 'trip-end-date', name: 'end_date', value: t.end_date ?? '' });
  const desc = h('textarea', { id: 'trip-description', name: 'description', rows: 3, placeholder: 'What is this trip about?', value: t.description ?? '' });
  const cover = h('input', { type: 'url', id: 'trip-cover', name: 'cover_image_url', placeholder: 'https://…', value: t.cover_image_url ?? '' });

  const fName = field('Trip name', name);
  const fStart = field('Starts', start, { className: 'te-date' });
  const fEnd = field('Ends', end, { className: 'te-date' });
  const fDesc = field('Description', desc);
  const fCover = field('Cover image link', cover, { hint: 'A link to an image. Optional.' });
  const formError = h('p', { class: 'field-error', id: 'metadata-error', hidden: true, attrs: { role: 'alert' } });
  const length = h('p', { class: 'te-length form-hint', id: 'trip-length' });

  const submitLabel = ctx.isNew ? 'Create trip and continue' : 'Continue to destinations';
  const submit = h('button', { type: 'submit', class: 'btn btn-primary te-primary', id: 'metadata-save-btn', text: submitLabel });

  const form = h('form', { id: 'metadata-form', class: 'te-form', noValidate: true },
    fName.el,
    h('div', { class: 'form-row' }, fStart.el, fEnd.el),
    length,
    h('details', { class: 'te-more' },
      h('summary', { text: 'More options' }),
      fDesc.el,
      fCover.el,
    ),
    formError,
    h('div', { class: 'te-actions' }, submit),
  );

  function read(): { name: string; start_date: string | null; end_date: string | null; description: string | null; cover: string } {
    return {
      name: cleanText(name.value).trim(),
      start_date: start.value || null,
      end_date: end.value || null,
      description: cleanText(desc.value).trim() || null,
      cover: cover.value.trim(),
    };
  }

  function validate(showEmptyName = false): boolean {
    const v = read();
    const errors = validateTripFields({ name: v.name, start_date: v.start_date, end_date: v.end_date });
    const coverError = validateHttpUrl(v.cover);
    fName.setError(!v.name && !showEmptyName ? null : errors.name ?? null);
    fStart.setError(errors.start_date ?? null);
    fEnd.setError(errors.end_date ?? null);
    fCover.setError(coverError);
    const span = v.start_date && v.end_date ? daysBetween(v.start_date, v.end_date) : null;
    length.textContent = span !== null && span >= 0 ? `${span + 1} day${span === 0 ? '' : 's'}` : 'Dates are optional. They let you plan day by day.';
    return isValid(errors) && !coverError;
  }

  // Keep the pickers consistent: the end can't precede the start.
  const syncBounds = (): void => { end.min = start.value; start.max = end.value; };

  const autosave = (): void => {
    syncBounds();
    if (ctx.isNew) { validate(); return; }
    if (!validate()) return;
    const v = read();
    store.patchTrip({
      name: v.name,
      start_date: v.start_date,
      end_date: v.end_date,
      description: v.description,
      cover_image_url: v.cover || null,
    });
  };
  for (const el of [name, start, end, desc, cover]) el.addEventListener('input', autosave);
  name.addEventListener('blur', () => {
    if (!ctx.isNew && !name.value.trim()) { name.value = store.trip.name; validate(); }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    formError.hidden = true;
    if (!validate(true)) {
      (form.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus();
      return;
    }
    if (!ctx.isNew) { ctx.go({ step: 'route' }); return; }
    const v = read();
    submit.disabled = true;
    submit.textContent = 'Creating…';
    ctx.createTrip({ name: v.name, description: v.description, start_date: v.start_date, end_date: v.end_date, cover_image_url: v.cover || null })
      .catch((err: unknown) => {
        const e2 = err as { status?: number } | null;
        formError.textContent = e2?.status === 422
          ? 'Some fields are not valid. Check the name and dates.'
          : e2?.status === 429
            ? 'You are creating trips too quickly. Wait a moment and try again.'
            : 'Could not create the trip. Check your connection and try again.';
        formError.hidden = false;
      })
      .finally(() => { submit.disabled = false; submit.textContent = submitLabel; });
  });

  syncBounds();
  validate();

  const el = h('div', { class: 'te-view te-trip' },
    h('h2', { class: 'te-h2', text: ctx.isNew ? 'Name your trip' : 'Trip details' }),
    h('p', { class: 'te-lead', text: ctx.isNew ? 'Just a name to start. You’ll add cities and places next, and everything saves as you go.' : 'Changes save automatically.' }),
    form,
  );

  return {
    el,
    update(event) {
      if (event.kind !== 'trip') return;
      // A change that did not come from these inputs (e.g. server copy): refresh untouched fields.
      const active = document.activeElement;
      if (active !== name) name.value = store.trip.name;
      if (active !== start) start.value = store.trip.start_date ?? '';
      if (active !== end) end.value = store.trip.end_date ?? '';
    },
    destroy() { /* listeners die with the nodes */ },
  };
}
