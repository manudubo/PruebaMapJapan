/**
 * Dashboard trip cards and list states (loading skeleton, empty, slow, error).
 *
 * DOM builders only: dashboard.ts decides when each state is shown. Everything user-supplied
 * (name, description, city names, cover URL) is inserted as text or through a validated URL.
 */

import type { ApiTrip } from '@/types';
import { setStyle, setText } from '@/modules/dom';
import { safeHttpUrl } from '@/modules/tripAdapter';
import { buildTripStops, describeCounts, groupTrips, summarizeTrip, tripHref } from '@/modules/tripView';

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------

function hashString(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

/** Two dark gradient stops derived from the trip, so each card without a cover image is distinct but stable. */
export function coverColors(seed: string): [string, string] {
  const hue = hashString(seed) % 360;
  return [`hsl(${hue} 55% 36%)`, `hsl(${(hue + 45) % 360} 60% 26%)`];
}

/** Initial of a city name, for the little route strip on the cover (first letter or digit, upper-cased). */
export function cityInitial(name: string): string {
  const match = /[\p{L}\p{N}]/u.exec(name);
  return match ? match[0].toUpperCase() : '·';
}

const MAX_ROUTE_CHIPS = 5;

function buildCover(trip: ApiTrip, phaseLabel: string, phase: string): HTMLElement {
  const [a, b] = coverColors(trip.id + trip.name);
  const cover = document.createElement('div');
  cover.className = 'trip-card-cover trip-card-cover--generated';
  setStyle(cover, '--cover-a', a);
  setStyle(cover, '--cover-b', b);

  // Uploaded cover: kept under the generated gradient so a blocked/broken image still looks intentional.
  const image = safeHttpUrl(trip.cover_image_url);
  if (image) {
    cover.classList.add('trip-card-cover--image');
    setStyle(cover, 'background-image', `url("${new URL(image).href}"), linear-gradient(135deg, ${a}, ${b})`);
  }

  if (trip.is_public) {
    const badge = document.createElement('span');
    badge.className = 'trip-card-badge trip-card-badge--public';
    badge.textContent = 'Public';
    cover.appendChild(badge);
  }
  if (phase !== 'undated') {
    const badge = document.createElement('span');
    badge.className = 'trip-card-badge trip-card-badge--phase';
    setText(badge, phaseLabel);
    cover.appendChild(badge);
  }

  const stops = buildTripStops(trip);
  if (stops.length > 0) {
    const route = document.createElement('ol');
    route.className = 'trip-card-route';
    route.setAttribute('aria-hidden', 'true');
    stops.slice(0, MAX_ROUTE_CHIPS).forEach((s) => {
      const li = document.createElement('li');
      setText(li, cityInitial(s.name));
      route.appendChild(li);
    });
    if (stops.length > MAX_ROUTE_CHIPS) {
      const more = document.createElement('li');
      more.className = 'more';
      more.textContent = `+${stops.length - MAX_ROUTE_CHIPS}`;
      route.appendChild(more);
    }
    cover.appendChild(route);
  }
  return cover;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function renderTripCard(trip: ApiTrip, now: Date = new Date()): HTMLElement {
  const sum = summarizeTrip(trip, now);

  const card = document.createElement('article');
  card.className = 'trip-card';
  card.dataset['phase'] = sum.phase;
  card.appendChild(buildCover(trip, sum.phaseLabel, sum.phase));

  const body = document.createElement('div');
  body.className = 'trip-card-body';

  const title = document.createElement('h3');
  title.className = 'trip-card-title';
  const link = document.createElement('a');
  link.className = 'trip-card-link';
  link.href = tripHref({ tripId: trip.id });
  setText(link, trip.name);
  title.appendChild(link);
  body.appendChild(title);

  if (trip.description) {
    const desc = document.createElement('p');
    desc.className = 'trip-card-desc';
    setText(desc, trip.description);
    body.appendChild(desc);
  }

  const dates = document.createElement('p');
  dates.className = 'trip-card-dates';
  setText(dates, sum.dateRange || 'Dates not set yet');
  body.appendChild(dates);

  const meta = document.createElement('ul');
  meta.className = 'trip-card-meta';
  meta.setAttribute('aria-label', 'Trip at a glance');
  for (const text of describeCounts(sum)) {
    const li = document.createElement('li');
    li.textContent = text;
    meta.appendChild(li);
  }
  body.appendChild(meta);

  if (sum.phase === 'active' || sum.phase === 'past') {
    const bar = document.createElement('div');
    bar.className = 'trip-card-progress';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', `Progress of ${trip.name}`);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(sum.progress ?? 0));
    bar.setAttribute('aria-valuetext', sum.phaseLabel);
    const fill = document.createElement('span');
    setStyle(fill, 'width', `${sum.progress ?? 0}%`);
    bar.appendChild(fill);
    body.appendChild(bar);
  }
  card.appendChild(body);

  // Edit (TRIP-01): a sibling of the title link, not nested in it, and above its stretched hit area.
  const actions = document.createElement('div');
  actions.className = 'trip-card-actions';
  const edit = document.createElement('a');
  edit.href = `trip-edit.html?tripId=${encodeURIComponent(trip.id)}`;
  edit.className = 'btn btn-secondary btn-small trip-card-edit';
  edit.textContent = 'Edit';
  edit.setAttribute('aria-label', `Edit ${trip.name}`);
  actions.appendChild(edit);
  card.appendChild(actions);

  return card;
}

/** The trips as dashboard sections (titles only when there is more than one group). */
export function renderTripGroups(grid: HTMLElement, trips: ApiTrip[], now: Date = new Date()): void {
  const groups = groupTrips(trips, now);
  grid.innerHTML = '';
  for (const group of groups) {
    if (groups.length > 1) {
      const heading = document.createElement('h2');
      heading.className = 'trips-section-title';
      heading.textContent = group.title;
      grid.appendChild(heading);
    }
    group.trips.forEach((t) => grid.appendChild(renderTripCard(t, now)));
  }
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function button(id: string, label: string, kind: 'primary' | 'secondary', onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.className = `btn btn-${kind}`;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

export function renderSkeletonCards(grid: HTMLElement, count = 3): void {
  grid.innerHTML = '';
  grid.setAttribute('aria-busy', 'true');
  const status = document.createElement('p');
  status.className = 'sr-only';
  status.setAttribute('role', 'status');
  status.textContent = 'Loading your trips';
  grid.appendChild(status);
  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'trip-card trip-card--skeleton';
    card.setAttribute('aria-hidden', 'true');
    const cover = document.createElement('div');
    cover.className = 'skeleton skeleton-cover';
    const body = document.createElement('div');
    body.className = 'trip-card-body';
    for (let l = 0; l < 3; l++) {
      const line = document.createElement('div');
      line.className = 'skeleton skeleton-line';
      body.appendChild(line);
    }
    card.append(cover, body);
    grid.appendChild(card);
  }
}

/** Banner above the skeleton when the API is slow: the request keeps going, the user may retry. */
export function showSlowNotice(grid: HTMLElement, onRetry: () => void): void {
  if (grid.querySelector('#trips-slow')) return;
  const notice = document.createElement('div');
  notice.id = 'trips-slow';
  notice.className = 'trips-notice';
  notice.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = 'Still loading your trips. The server is taking longer than usual.';
  notice.append(text, button('trips-slow-retry', 'Try again', 'secondary', onRetry));
  grid.prepend(notice);
}

export function renderEmptyState(grid: HTMLElement, onCreate: () => void, demoHref = 'index.html#demo'): void {
  grid.innerHTML = '';
  grid.removeAttribute('aria-busy');
  const empty = document.createElement('div');
  empty.className = 'trips-state trips-empty';

  const mark = document.createElement('div');
  mark.className = 'trips-state-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML =
    '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';

  const heading = document.createElement('h2');
  heading.textContent = 'Plan your first trip';
  const p = document.createElement('p');
  p.textContent =
    "You don't have any trips saved yet. Add the cities you will visit and see them on a map, day by day, just like the demo.";

  const actions = document.createElement('div');
  actions.className = 'trips-state-actions';
  const create = button('empty-state-create-btn', 'Create your first trip', 'primary', onCreate);
  const demo = document.createElement('a');
  demo.className = 'btn btn-secondary';
  demo.id = 'empty-state-demo-link';
  demo.href = demoHref;
  demo.textContent = 'See the demo';
  actions.append(create, demo);

  empty.append(mark, heading, p, actions);
  grid.appendChild(empty);
}

export function renderLoadError(grid: HTMLElement, onRetry: () => void): void {
  grid.innerHTML = '';
  grid.removeAttribute('aria-busy');
  const box = document.createElement('div');
  box.className = 'trips-state trips-error';
  box.id = 'trips-error';
  box.setAttribute('role', 'alert');
  const heading = document.createElement('h2');
  heading.textContent = "We couldn't load your trips";
  const p = document.createElement('p');
  p.textContent = 'Your trips are safe. Check your connection and try again.';
  const actions = document.createElement('div');
  actions.className = 'trips-state-actions';
  actions.appendChild(button('trips-retry-btn', 'Try again', 'primary', onRetry));
  box.append(heading, p, actions);
  grid.appendChild(box);
}
