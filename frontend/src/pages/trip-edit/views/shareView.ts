/**
 * Step 3 — review and share: a checklist of what makes the trip look like the
 * demo, public/private, the copyable public link, and a way to view the trip.
 */

import { publishChecklist, tripSummary, type ChecklistItem } from '../model';
import { h, icon, announce } from '../ui/h';
import type { MountedView, View, ViewCtx } from './types';

const FIX_TARGET: Record<ChecklistItem['id'], View | null> = {
  name: { step: 'trip' },
  dates: { step: 'trip' },
  cities: { step: 'route' },
  places: { step: 'route' },
  located: { step: 'route' },
};

export function mountShareView(ctx: ViewCtx): MountedView {
  const { store } = ctx;

  const stats = h('p', { class: 'te-stats', id: 'share-stats' });
  const checklist = h('ul', { class: 'te-checklist', id: 'share-checklist' });

  const publicInput = h('input', { type: 'checkbox', id: 'trip-public', name: 'is_public' });
  const publicHint = h('p', { class: 'form-hint', id: 'trip-public-hint' });
  publicInput.setAttribute('aria-describedby', 'trip-public-hint');
  const linkInput = h('input', { type: 'text', readOnly: true, id: 'public-link', class: 'te-link-input', attrs: { 'aria-label': 'Public link' } });
  const copyBtn = h('button', { type: 'button', class: 'btn btn-secondary', id: 'copy-link' }, icon('copy', 16), 'Copy link');
  const copyStatus = h('p', { class: 'form-hint', id: 'copy-status', attrs: { role: 'status' } });
  const linkRow = h('div', { class: 'te-link-row', hidden: true }, linkInput, copyBtn);

  const viewLink = h('a', { class: 'btn btn-primary', id: 'view-trip', text: 'View trip' });
  viewLink.setAttribute('href', ctx.tripPageUrl(store.trip.id));
  const trips = h('a', { class: 'btn btn-secondary', href: 'dashboard.html', text: 'Back to my trips' });

  publicInput.addEventListener('change', () => {
    store.patchTrip({ is_public: publicInput.checked }, true);
    announce(publicInput.checked ? 'Trip is now public' : 'Trip is now private');
    render();
  });
  copyBtn.addEventListener('click', async () => {
    const ok = await ctx.copyText(linkInput.value);
    copyStatus.textContent = ok ? 'Link copied.' : 'Could not copy. Select the link and copy it manually.';
    if (!ok) { linkInput.focus(); linkInput.select(); }
  });
  linkInput.addEventListener('focus', () => linkInput.select());

  function render(): void {
    const t = store.trip;
    const s = tripSummary(t);
    stats.textContent = `${s.cities} destination${s.cities === 1 ? '' : 's'} · ${s.days} day${s.days === 1 ? '' : 's'} planned · ${s.places} place${s.places === 1 ? '' : 's'}`;

    checklist.replaceChildren();
    for (const item of publishChecklist(t)) {
      const target = FIX_TARGET[item.id];
      const li = h('li', { class: `te-check-item${item.done ? ' is-done' : ''}` },
        h('span', { class: 'te-check-mark', attrs: { 'aria-hidden': 'true' } }, item.done ? icon('check', 14) : null),
        h('span', { class: 'sr-only', text: item.done ? 'Done: ' : item.optional ? 'Optional: ' : 'To do: ' }),
        h('span', { class: 'te-check-text', text: item.text }),
        !item.done && target ? h('button', { type: 'button', class: 'btn-link', text: 'Fix', on: { click: () => ctx.go(target) } }) : null,
      );
      checklist.append(li);
    }

    publicInput.checked = t.is_public;
    const slug = t.public_slug;
    publicHint.textContent = t.is_public
      ? 'Anyone with the link can view this trip. They can’t edit it.'
      : 'Only you can see this trip. Turn this on to get a link you can share.';
    if (t.is_public && slug) {
      linkInput.value = ctx.publicPageUrl(slug);
      linkRow.hidden = false;
    } else if (t.is_public) {
      linkInput.value = '';
      linkRow.hidden = true;
      publicHint.textContent = 'Anyone with the link can view this trip. Creating your link…';
    } else {
      linkRow.hidden = true;
      copyStatus.textContent = '';
    }
  }

  const el = h('div', { class: 'te-view te-share' },
    h('h2', { class: 'te-h2', text: 'Review and share' }),
    stats,
    h('h3', { class: 'te-h3', text: 'Before you share' }),
    checklist,
    h('h3', { class: 'te-h3', text: 'Visibility' }),
    h('div', { class: 'form-group form-group--checkbox te-check' },
      h('label', { class: 'checkbox-label' }, publicInput, 'Make this trip public'),
      publicHint),
    linkRow,
    copyStatus,
    h('div', { class: 'te-actions te-actions--split' }, trips, viewLink),
  );
  render();

  return {
    el,
    update() { render(); },
    destroy() { /* nothing */ },
  };
}
