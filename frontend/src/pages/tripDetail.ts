/**
 * Trip page (trip.html): a saved trip, shown the way the demo is.
 *
 * Two views over the same loaded trip, switched without a reload:
 *  - overview (no `destIndex`): trip header with dates/countdown/stats, a map with every city
 *    numbered in visiting order and joined by a dashed line, and one card per city;
 *  - city (`destIndex=n`): that city's day filter, map, activities by day and hotel.
 *
 * URL format: trip.html?tripId=<id>[&destIndex=<n>]   (owner)
 *             trip.html?slug=<public slug>[&destIndex=<n>]   (shared, no sign-in)
 *
 * The pure logic (summary, stops, URLs, error wording) lives in modules/tripView.ts; the data is
 * adapted from the API by modules/tripAdapter.ts; maps come from modules/baseMap.ts (OSM tiles,
 * attribution), modules/overviewMap.ts and modules/declutter.ts, like the demo pages.
 */

import '@/styles/main.css';
import '@/styles/trip-view.css';
import '@/components/Navbar';
import '@/components/SearchBar';

import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { initTheme } from '@/modules/theme';
import { createBaseMap, switchBaseMapTheme } from '@/modules/baseMap';
import { createOverviewMap, type OverviewMap, type OverviewStop } from '@/modules/overviewMap';
import { DeclutteredMarker, declutterMarkers } from '@/modules/declutter';
import { initCountdown } from '@/modules/countdown';
import { login } from '@/auth/keycloak';
import { registrationEnabled, wireSignUpButton, takeSignUpOutcome } from '@/auth/registration';
import {
  watchAuth,
  showAuthPending,
  hideAuthPending,
  showAuthUnavailableState,
  clearAuthUnavailableState,
  showAuthNotice,
  showSignUpNotice,
} from '@/auth/authStatusUI';
import { getTrip, getPublicTrip } from '@/api/client';
import { apiDestinationToCityData, safeHttpUrl, toCoords } from '@/modules/tripAdapter';
import {
  buildTripStops,
  describeCounts,
  describeTripError,
  destinationCoords,
  parseTripLocation,
  resolveDestIndex,
  summarizeTrip,
  tripDateSpan,
  tripHref,
  type TripProblem,
  type TripRef,
  type TripStop,
} from '@/modules/tripView';
import { getMapsUrl } from '@/data/maps';
import { createDirectionsUrl, createPlaceUrl, announceToScreenReader, escapeHtml } from '@/modules/utils';
import type { ApiDestination, ApiHotel, ApiTrip, CityData, Activity, Day, Hotel } from '@/types';
import DOMPurify from 'dompurify';
import { setText, setStyle } from '@/modules/dom';
import { installGlobalErrorHandler } from '@/modules/toast';

/** After this long without an answer the page says so and offers "Try again" (the request keeps going). */
export const SLOW_LOAD_MS = 3000;

const byId = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

// ---------------------------------------------------------------------------
// Popups and legend items (exported for tests)
// ---------------------------------------------------------------------------

const PIN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const ARROW_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>';

/**
 * "View on Maps" target for an activity (BIZ-03): the link saved in the
 * editor, else the demo's static per-name table, else a pin search on the
 * activity's coordinates. Null when there is nothing to link to.
 */
export function resolveActivityMapsUrl(activity: Activity): string | null {
  return (
    activity.mapsUrl ??
    getMapsUrl(activity.name) ??
    (activity.coords ? createPlaceUrl(activity.coords) : null)
  );
}

function popupLinks(mapsUrl: string, coords: [number, number]): string {
  return `<div class="popup-links">
      <a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener" class="popup-link">${PIN_ICON}<span>View on Maps</span></a>
      <a href="${escapeHtml(createDirectionsUrl(coords))}" target="_blank" rel="noopener" class="popup-link directions">${ARROW_ICON}<span>Directions</span></a>
    </div>`;
}

export function buildPopup(activity: Activity, day: Day, mapsUrl: string | null): string {
  const badge = activity.optional ? `<span class="optional-badge">Option ${escapeHtml(activity.optional)}</span>` : '';
  const time = activity.time ? ` · <time class="popup-time">${escapeHtml(activity.time)}</time>` : '';
  let html = `<div class="day-label">${escapeHtml(day.label)}${time}${badge}</div><h4>${escapeHtml(activity.name)}</h4>`;
  if (activity.notes) html += `<p>${escapeHtml(activity.notes)}</p>`;
  if (!activity.isGeneric && mapsUrl && activity.coords) html += popupLinks(mapsUrl, activity.coords);
  return DOMPurify.sanitize(html);
}

export function buildHotelPopup(hotel: Hotel, mapsUrl: string | null): string {
  let html = `<h4>${escapeHtml(hotel.name)}</h4><p>Accommodation</p>`;
  if (mapsUrl && hotel.coords) html += popupLinks(mapsUrl, hotel.coords);
  return DOMPurify.sanitize(html);
}

function actionLink(href: string, className: string, title: string, icon: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.className = className;
  a.title = title;
  a.setAttribute('aria-label', title);
  a.innerHTML = icon.replace('width="14" height="14"', '');
  return a;
}

function buildActions(mapsUrl: string, coords: [number, number], subject: string): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'legend-actions';
  actions.appendChild(actionLink(mapsUrl, 'legend-action-btn', `View ${subject} on Google Maps`, PIN_ICON));
  actions.appendChild(
    actionLink(createDirectionsUrl(coords), 'legend-action-btn directions', `Directions to ${subject}`, ARROW_ICON),
  );
  return actions;
}

export function buildLegendItem(activity: Activity, idx: number, day: Day): HTMLElement {
  const isOptional = !!activity.optional;
  const markerLabel = isOptional ? activity.optional! : idx + 1;
  const markerColor = isOptional ? '#af52de' : day.color;
  const mapsUrl = resolveActivityMapsUrl(activity);
  const item = document.createElement('li');
  item.className = 'legend-item' + (isOptional ? ' is-optional' : '');
  const noteText = activity.notes
    ? activity.notes.length > 50
      ? activity.notes.substring(0, 50) + '...'
      : activity.notes
    : '';
  const markerDiv = document.createElement('div');
  markerDiv.className = 'legend-marker';
  setStyle(markerDiv, 'background', String(markerColor));
  setText(markerDiv, String(markerLabel));
  item.appendChild(markerDiv);

  const contentDiv = document.createElement('div');
  contentDiv.className = 'legend-content';
  const nameEl = document.createElement('strong');
  if (activity.time) {
    const timeEl = document.createElement('time');
    timeEl.className = 'legend-time';
    timeEl.dateTime = activity.time;
    setText(timeEl, activity.time);
    nameEl.appendChild(timeEl);
  }
  nameEl.appendChild(document.createTextNode(activity.name));
  contentDiv.appendChild(nameEl);
  if (noteText) {
    const noteEl = document.createElement('small');
    setText(noteEl, noteText);
    contentDiv.appendChild(noteEl);
  }
  item.appendChild(contentDiv);

  if (!activity.isGeneric && mapsUrl && activity.coords) {
    item.appendChild(buildActions(mapsUrl, activity.coords, activity.name));
  }
  return item;
}

// ---------------------------------------------------------------------------
// Page state
// ---------------------------------------------------------------------------

type Mode = 'owner' | 'public';

let mode: Mode = 'owner';
let ref: TripRef = {};
let trip: ApiTrip | null = null;
let destinations: ApiDestination[] = [];
let stops: TripStop[] = [];

let overviewMap: OverviewMap | null = null;
let cityMap: L.Map | null = null;
let cityTileLayer: L.TileLayer | null = null;
let stopCountdown: (() => void) | null = null;

let loadSeq = 0;
let slowTimer: ReturnType<typeof setTimeout> | undefined;

function teardownMaps(): void {
  overviewMap?.destroy();
  overviewMap = null;
  cityMap?.remove();
  cityMap = null;
  cityTileLayer = null;
  window.currentMap = null;
  window.currentTileLayer = null;
  stopCountdown?.();
  stopCountdown = null;
}

function mountMapElement(slot: HTMLElement, label: string, describedBy?: string): HTMLElement {
  // One static #map in trip.html (role + name for the a11y audit), moved into whichever view is shown.
  const el = byId('map') ?? Object.assign(document.createElement('div'), { id: 'map' });
  el.className = '';
  el.innerHTML = '';
  el.removeAttribute('tabindex');
  el.setAttribute('role', 'application');
  el.setAttribute('aria-label', label);
  if (describedBy) el.setAttribute('aria-describedby', describedBy);
  else el.removeAttribute('aria-describedby');
  slot.prepend(el);
  return el;
}

function setNote(id: string, text: string | null): void {
  const note = byId(id);
  if (!note) return;
  note.hidden = text === null;
  note.textContent = text ?? '';
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

interface HeaderContent {
  title: string;
  subtitle: string;
  chip?: string;
  chipPhase?: string;
  description?: string | null;
  stats?: string[];
  back?: { href: string; text: string };
}

function renderHeader(h: HeaderContent): void {
  const title = byId('trip-title');
  if (title) {
    setText(title, h.title);
    title.tabIndex = -1;
  }
  const subtitle = byId('trip-subtitle');
  if (subtitle) {
    setText(subtitle, h.subtitle);
    subtitle.hidden = !h.subtitle;
  }

  const chip = byId('trip-chip');
  if (chip) {
    chip.hidden = !h.chip;
    setText(chip, h.chip ?? '');
    chip.dataset['phase'] = h.chipPhase ?? '';
  }

  const description = byId('trip-description');
  if (description) {
    description.hidden = !h.description;
    setText(description, h.description ?? '');
  }

  const statsEl = byId('trip-stats');
  if (statsEl) {
    statsEl.innerHTML = '';
    for (const text of h.stats ?? []) {
      const li = document.createElement('li');
      setText(li, text);
      statsEl.appendChild(li);
    }
    statsEl.hidden = !h.stats?.length;
  }

  const back = byId<HTMLAnchorElement>('trip-back');
  if (back) {
    back.hidden = !h.back;
    if (h.back) {
      back.setAttribute('href', h.back.href);
      setText(back, h.back.text);
    }
  }
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function overviewStop(stop: TripStop): OverviewStop {
  return {
    key: stop.key,
    number: stop.number,
    name: stop.label,
    label: stop.label,
    dates: stop.dates,
    coords: stop.coords!,
    color: stop.color,
    link: tripHref(ref, stop.index),
  };
}

function cityCountsText(stop: TripStop): string {
  const parts = [stop.dates];
  if (stop.dayCount) parts.push(`${stop.dayCount} ${stop.dayCount === 1 ? 'day' : 'days'}`);
  if (stop.placeCount) parts.push(`${stop.placeCount} ${stop.placeCount === 1 ? 'place' : 'places'}`);
  return parts.filter(Boolean).join(' · ') || 'No dates yet';
}

export function buildCityCard(stop: TripStop, href: string): HTMLAnchorElement {
  const card = document.createElement('a');
  card.className = 'city-card';
  card.href = href;
  card.dataset['city'] = stop.key;

  const marker = document.createElement('span');
  marker.className = 'city-marker' + (stop.coords ? '' : ' is-unlocated');
  marker.setAttribute('aria-hidden', 'true');
  if (stop.coords) setStyle(marker, 'background', stop.color);
  setText(marker, String(stop.number));
  card.appendChild(marker);

  const info = document.createElement('div');
  info.className = 'city-info';
  const name = document.createElement('strong');
  setText(name, stop.label);
  info.appendChild(name);
  const small = document.createElement('small');
  setText(small, cityCountsText(stop));
  info.appendChild(small);
  if (!stop.coords) {
    const tag = document.createElement('span');
    tag.className = 'city-nopin';
    tag.textContent = 'No location yet';
    info.appendChild(tag);
  }
  card.appendChild(info);
  return card;
}

function renderOverview(): void {
  if (!trip) return;
  const sum = summarizeTrip(trip);
  const owner = mode === 'owner';

  const chipParts: string[] = [];
  if (mode === 'public') chipParts.push('Shared trip');
  if (sum.phase !== 'undated') chipParts.push(sum.phaseLabel);
  renderHeader({
    title: trip.name,
    subtitle: sum.dateRange || 'Dates not set yet',
    chip: chipParts.join(' · '),
    chipPhase: sum.phase,
    description: trip.description,
    stats: stops.length ? describeCounts(sum) : [],
    back: owner ? { href: 'dashboard.html', text: 'My trips' } : undefined,
  });
  document.title = `${trip.name} – Itinerary`;

  byId('view-city')!.hidden = true;
  byId('view-overview')!.hidden = false;

  // Countdown while the trip is ahead; progress while it is under way.
  const wrap = byId('demo-countdown-wrap');
  const span = tripDateSpan(trip);
  if (wrap) {
    if (sum.phase === 'upcoming' && span.start) {
      wrap.dataset['tripStart'] = span.start;
      wrap.hidden = false;
      stopCountdown = initCountdown();
    } else {
      wrap.hidden = true;
    }
  }
  const progress = byId('trip-progress');
  if (progress) {
    progress.hidden = sum.phase !== 'active';
    if (sum.phase === 'active') {
      const bar = progress.querySelector<HTMLElement>('[role="progressbar"]')!;
      bar.setAttribute('aria-valuenow', String(sum.progress ?? 0));
      bar.setAttribute('aria-valuetext', sum.phaseLabel);
      setStyle(byId('trip-progress-fill')!, 'width', `${sum.progress ?? 0}%`);
      setText(byId('trip-progress-label')!, `${sum.phaseLabel} · ${sum.progress ?? 0}% of the trip`);
    }
  }

  const list = byId('overview-cities')!;
  const empty = byId('trip-empty')!;
  list.innerHTML = '';
  const slot = byId('overview-map-slot')!;
  const located = stops.filter((s) => s.coords);

  if (stops.length === 0) {
    slot.hidden = true;
    setNote('overview-map-note', null);
    list.hidden = true;
    empty.hidden = false;
    empty.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = owner
      ? 'This trip has no cities yet. Add the first one to see it on the map.'
      : 'The owner has not added any cities to this trip yet.';
    empty.appendChild(p);
    if (owner) {
      const edit = document.createElement('a');
      edit.className = 'btn btn-primary';
      edit.href = `trip-edit.html?tripId=${encodeURIComponent(trip.id)}`;
      edit.textContent = 'Add a city';
      empty.appendChild(edit);
    }
    announceToScreenReader(`${trip.name}: no cities yet`);
    return;
  }

  empty.hidden = true;
  list.hidden = false;
  stops.forEach((s) => list.appendChild(buildCityCard(s, tripHref(ref, s.index))));

  if (located.length === 0) {
    slot.hidden = true;
    setNote('overview-map-note', 'None of the cities has a location yet, so there is no map to show.');
    return;
  }
  slot.hidden = false;
  const missing = stops.length - located.length;
  setNote(
    'overview-map-note',
    missing > 0
      ? `${missing} of ${stops.length} ${stops.length === 1 ? 'city has' : 'cities have'} no location yet and ${missing === 1 ? 'is' : 'are'} not on the map.`
      : null,
  );

  const mapEl = mountMapElement(slot, `Map of ${trip.name}`, 'overview-map-help');
  overviewMap = createOverviewMap(located.map(overviewStop), mapEl, list, { view: 'fit', declutter: true });
}

// ---------------------------------------------------------------------------
// City view
// ---------------------------------------------------------------------------

function createMarkerIcon(label: string | number, color: string, isOptional = false): L.DivIcon {
  const div = document.createElement('div');
  div.className = isOptional ? 'numbered-marker optional' : 'numbered-marker';
  setStyle(div, 'background', color);
  div.textContent = String(label);
  return L.divIcon({ className: 'custom-marker', html: div, iconSize: [28, 28], iconAnchor: [14, 14] });
}

function createHotelIcon(): L.DivIcon {
  return L.divIcon({
    className: 'custom-marker',
    html: '<div class="hotel-marker">H</div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function hotelView(hotel: ApiHotel): { hotel: Hotel; mapsUrl: string | null } {
  const coords = toCoords(hotel.lat, hotel.lng);
  const view: Hotel = { name: hotel.name, coords };
  const mapsUrl = safeHttpUrl(hotel.url) ?? getMapsUrl(hotel.name) ?? (coords ? createPlaceUrl(coords) : null);
  return { hotel: view, mapsUrl };
}

function renderCity(index: number): void {
  if (!trip) return;
  const stop = stops[index]!;
  const dest = destinations[index]!;
  const data = apiDestinationToCityData(dest);
  const dayCount = Object.keys(data.days).length;

  renderHeader({
    title: stop.name,
    subtitle: [stop.dates, `${dayCount} ${dayCount === 1 ? 'day' : 'days'}`, stop.placeCount ? `${stop.placeCount} ${stop.placeCount === 1 ? 'place' : 'places'}` : '']
      .filter(Boolean)
      .join(' · '),
    back: { href: tripHref(ref), text: trip.name },
  });
  document.title = `${stop.label} · ${trip.name} – Itinerary`;

  byId('view-overview')!.hidden = true;
  byId('view-city')!.hidden = false;
  buildCityTabs(index);

  const hotelInfo = dest.hotel ? hotelView(dest.hotel) : null;
  const hasLocation =
    destinationCoords(dest) !== null ||
    Object.values(data.days).some((d) => d.activities.some((a) => a.coords));
  const slot = byId('city-map-slot')!;
  const hotelBtn = byId<HTMLButtonElement>('hotel-btn')!;
  const daySelector = byId('day-selector')!;

  generateLegend(data, hotelInfo);

  if (!hasLocation) {
    slot.hidden = true;
    daySelector.hidden = true;
    daySelector.innerHTML = '';
    setNote('city-map-note', `No locations have been added for ${stop.name} yet, so there is no map to show.`);
    return;
  }
  slot.hidden = false;
  daySelector.hidden = false;
  setNote('city-map-note', null);

  const mapEl = mountMapElement(slot, `Map of ${stop.name}`);
  const { map, tileLayer } = createBaseMap(mapEl, data.center, data.zoom);
  cityMap = map;
  cityTileLayer = tileLayer;
  window.currentMap = map;
  window.currentTileLayer = tileLayer;

  const markersByDay: Record<string, DeclutteredMarker[]> = {};
  const allMarkers: DeclutteredMarker[] = [];
  daySelector.innerHTML = '';

  Object.entries(data.days).forEach(([dateKey, day]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-btn' + (day.hasOptions ? ' has-options' : '');
    btn.textContent = day.label;
    btn.dataset['day'] = dateKey;
    btn.setAttribute('aria-pressed', 'false');
    if (day.hasOptions) btn.title = 'This day has alternative options';
    daySelector.appendChild(btn);

    markersByDay[dateKey] = [];
    day.activities.forEach((activity, idx) => {
      if (!activity.coords) return;
      const isOptional = !!activity.optional;
      const marker = new DeclutteredMarker(activity.coords, {
        icon: createMarkerIcon(isOptional ? activity.optional! : idx + 1, isOptional ? '#af52de' : day.color, isOptional),
        alt: activity.name,
      });
      marker.bindPopup(buildPopup(activity, day, resolveActivityMapsUrl(activity)));
      markersByDay[dateKey]!.push(marker);
      allMarkers.push(marker);
    });
  });

  let hotelMarker: DeclutteredMarker | null = null;
  if (hotelInfo?.hotel.coords) {
    hotelMarker = new DeclutteredMarker(hotelInfo.hotel.coords, { icon: createHotelIcon(), alt: hotelInfo.hotel.name });
    hotelMarker.bindPopup(buildHotelPopup(hotelInfo.hotel, hotelInfo.mapsUrl)).addTo(map);
  }
  allMarkers.forEach((m) => m.addTo(map));
  // Overlapping markers are nudged apart (A11Y-04 target size); redone on zoom and day changes.
  const declutter = (): void => {
    declutterMarkers(map, hotelMarker ? [hotelMarker, ...allMarkers] : allMarkers);
  };
  declutter();
  map.on('zoomend', declutter);
  setupDayFilter(daySelector, map, data, markersByDay, allMarkers, declutter);

  const hotelCoords = hotelInfo?.hotel.coords;
  hotelBtn.hidden = !hotelCoords;
  hotelBtn.onclick = hotelCoords ? () => map.setView(hotelCoords, 15) : null;

  announceToScreenReader(`Map of ${stop.name} loaded with ${allMarkers.length} locations`);
}

function buildCityTabs(activeIndex: number): void {
  const tabs = byId('dest-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';
  tabs.hidden = stops.length < 2;
  stops.forEach((s) => {
    const a = document.createElement('a');
    a.className = 'dest-tab' + (s.index === activeIndex ? ' is-active' : '');
    a.href = tripHref(ref, s.index);
    a.title = s.label;
    setText(a, s.label);
    if (s.index === activeIndex) a.setAttribute('aria-current', 'page');
    tabs.appendChild(a);
  });
}

function setupDayFilter(
  daySelector: HTMLElement,
  map: L.Map,
  data: CityData,
  markersByDay: Record<string, L.Marker[]>,
  allMarkers: L.Marker[],
  onMarkersChanged: () => void,
): void {
  let activeDay: string | null = null;
  const groups = (): NodeListOf<HTMLElement> => document.querySelectorAll<HTMLElement>('#legend-grid .day-group');
  const clearPressed = (): void => {
    daySelector.querySelectorAll('.day-btn').forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
  };

  // onclick (not addEventListener): the selector element is reused across city switches.
  daySelector.onclick = (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.day-btn');
    if (!target) return;
    const selectedDay = target.dataset['day']!;

    if (activeDay === selectedDay) {
      activeDay = null;
      clearPressed();
      allMarkers.forEach((m) => m.addTo(map));
      map.setView(data.center, data.zoom);
      onMarkersChanged();
      groups().forEach((g) => { g.hidden = false; });
      announceToScreenReader('Showing all days');
      return;
    }

    activeDay = selectedDay;
    clearPressed();
    target.classList.add('active');
    target.setAttribute('aria-pressed', 'true');
    allMarkers.forEach((m) => map.removeLayer(m));
    const dayMarkers = markersByDay[selectedDay] ?? [];
    dayMarkers.forEach((m) => m.addTo(map));
    onMarkersChanged();
    if (dayMarkers.length > 0) map.fitBounds(L.featureGroup(dayMarkers).getBounds().pad(0.3));
    groups().forEach((g) => { g.hidden = g.dataset['day'] !== selectedDay; });
    announceToScreenReader(`Showing ${data.days[selectedDay]?.label ?? 'day'}: ${dayMarkers.length} locations`);
  };
}

function generateLegend(data: CityData, hotelInfo: { hotel: Hotel; mapsUrl: string | null } | null): void {
  const legendGrid = byId('legend-grid');
  if (!legendGrid) return;
  legendGrid.innerHTML = '';
  legendGrid.setAttribute('role', 'region');
  legendGrid.setAttribute('aria-label', 'Activity list by day');

  const entries = Object.entries(data.days);
  if (entries.length === 0) {
    const p = document.createElement('p');
    p.className = 'trip-empty-note';
    p.textContent = `No days have been planned for ${data.name} yet.`;
    legendGrid.appendChild(p);
  }

  entries.forEach(([dateKey, day]) => {
    const dayGroup = document.createElement('div');
    dayGroup.className = 'day-group' + (day.hasOptions ? ' has-options' : '');
    dayGroup.dataset['day'] = dateKey;
    dayGroup.id = `day-${dateKey}`;
    const header = document.createElement('div');
    header.className = 'day-group-header';
    const colorDot = document.createElement('div');
    colorDot.className = 'day-group-color';
    setStyle(colorDot, 'background', day.color);
    header.appendChild(colorDot);
    const labelSpan = document.createElement('span');
    labelSpan.className = 'day-group-label';
    setText(labelSpan, day.label);
    header.appendChild(labelSpan);
    if (day.hasOptions) {
      const badge = document.createElement('span');
      badge.className = 'day-group-badge';
      badge.textContent = 'Options';
      header.appendChild(badge);
    }
    dayGroup.appendChild(header);
    const list = document.createElement('ul');
    list.className = 'day-activities';
    if (day.activities.length === 0) {
      const none = document.createElement('li');
      none.className = 'legend-empty';
      none.textContent = 'Nothing planned for this day yet.';
      list.appendChild(none);
    }
    day.activities.forEach((act, idx) => list.appendChild(buildLegendItem(act, idx, day)));
    dayGroup.appendChild(list);
    legendGrid.appendChild(dayGroup);
  });

  updateHotelInfo(hotelInfo);
}

function updateHotelInfo(info: { hotel: Hotel; mapsUrl: string | null } | null): void {
  const hotelInfo = byId('hotel-info');
  if (!hotelInfo) return;
  hotelInfo.innerHTML = '';
  hotelInfo.hidden = !info;
  if (!info) return;

  const markerDiv = document.createElement('div');
  markerDiv.className = 'marker';
  markerDiv.textContent = 'H';
  hotelInfo.appendChild(markerDiv);

  const nameSpan = document.createElement('span');
  setText(nameSpan, info.hotel.name);
  hotelInfo.appendChild(nameSpan);

  if (info.mapsUrl && info.hotel.coords) {
    hotelInfo.appendChild(buildActions(info.mapsUrl, info.hotel.coords, info.hotel.name));
  }
  const legend = document.querySelector('.legend');
  if (legend && hotelInfo.parentElement === legend) legend.insertBefore(hotelInfo, legend.firstChild);
}

// ---------------------------------------------------------------------------
// Routing between the two views (no reload)
// ---------------------------------------------------------------------------

function showView(requested: number | null, userInitiated: boolean): void {
  if (!trip) return;
  teardownMaps();
  const index = resolveDestIndex(requested, stops.length);
  if (index === null) renderOverview();
  else renderCity(index);

  if (userInitiated) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    byId('trip-header')?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    byId('trip-title')?.focus({ preventScroll: true });
  }
}

function navigate(destIndex: number | null): void {
  const url = new URL(window.location.href);
  if (destIndex === null) url.searchParams.delete('destIndex');
  else url.searchParams.set('destIndex', String(destIndex));
  window.history.pushState({}, '', url.toString());
  showView(destIndex, true);
}

function onCardClick(e: MouseEvent): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.('a');
  if (!a || (a.target && a.target !== '_self')) return;
  const raw = a.getAttribute('href') ?? '';
  if (!raw.startsWith('trip.html?')) return;
  const loc = parseTripLocation(raw.slice('trip.html'.length));
  if ((loc.slug ?? loc.tripId) !== (ref.slug ?? ref.tripId)) return;
  e.preventDefault();
  navigate(loc.destIndex);
}

// ---------------------------------------------------------------------------
// Loading, problems
// ---------------------------------------------------------------------------

function setLoading(on: boolean): void {
  clearTimeout(slowTimer);
  const card = byId('trip-card');
  card?.setAttribute('aria-busy', String(on));
  byId('trip-skeleton')!.hidden = !on;
  byId('trip-slow')!.hidden = true;
  if (on) slowTimer = setTimeout(() => { byId('trip-slow')!.hidden = false; }, SLOW_LOAD_MS);
}

function clearProblem(): void {
  byId('trip-problem')?.remove();
  const card = byId('trip-card');
  if (card) card.hidden = false;
}

interface ProblemOptions {
  signedOut?: boolean;
  onRetry?: () => void;
}

function showError(problem: Pick<TripProblem, 'title' | 'message' | 'retryable'>, options: ProblemOptions = {}): void {
  const main = byId('main-content');
  if (!main) return;
  setLoading(false);
  clearProblem();
  const card = byId('trip-card');
  if (card) card.hidden = true;

  const panel = document.createElement('div');
  panel.id = 'trip-problem';
  panel.className = 'page-card trip-problem';
  const alert = document.createElement('div');
  alert.setAttribute('role', 'alert');
  const heading = document.createElement('h1');
  heading.textContent = problem.title;
  heading.tabIndex = -1;
  const p = document.createElement('p');
  setText(p, problem.message);
  alert.append(heading, p);
  panel.appendChild(alert);

  const actions = document.createElement('div');
  actions.className = 'trip-problem-actions';
  if (options.signedOut) {
    // Signed out: the trip may well be theirs. Offer Sign in (back to this trip) / Sign up.
    const here = window.location.href;
    if (registrationEnabled()) {
      const signup = document.createElement('button');
      signup.type = 'button';
      signup.id = 'trip-signup-btn';
      signup.className = 'btn btn-primary';
      signup.textContent = 'Sign up';
      wireSignUpButton(signup, () => showSignUpNotice('unavailable'));
      actions.appendChild(signup);
    }
    const signin = document.createElement('button');
    signin.type = 'button';
    signin.id = 'trip-login-btn';
    signin.className = registrationEnabled() ? 'btn btn-secondary' : 'btn btn-primary';
    signin.textContent = 'Sign in';
    signin.addEventListener('click', () => { void login(here).catch(() => showAuthNotice()); });
    actions.appendChild(signin);
  }
  if (problem.retryable && options.onRetry) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.id = 'trip-retry-btn';
    retry.className = 'btn btn-primary';
    retry.textContent = 'Try again';
    retry.addEventListener('click', options.onRetry);
    actions.appendChild(retry);
  }
  const back = document.createElement('a');
  back.className = 'btn btn-secondary';
  back.href = mode === 'owner' ? 'dashboard.html' : 'index.html';
  back.textContent = mode === 'owner' ? 'Back to dashboard' : 'Back to home';
  actions.appendChild(back);
  panel.appendChild(actions);

  main.prepend(panel);
  document.title = `${problem.title} – Itinerary`;
  document.body.classList.add('ready');
}

async function loadTrip(): Promise<void> {
  const seq = ++loadSeq;
  clearProblem();
  setLoading(true);
  try {
    const loaded = mode === 'public' ? await getPublicTrip(ref.slug!) : await getTrip(ref.tripId!);
    if (trip) return; // another attempt already answered
    onLoaded(loaded);
  } catch (err) {
    if (trip || seq !== loadSeq) return; // superseded by a retry, or already shown
    showError(describeTripError(err, mode), { onRetry: () => { void loadTrip(); } });
  }
}

function onLoaded(loaded: ApiTrip): void {
  trip = loaded;
  destinations = loaded.destinations.slice().sort((a, b) => a.order_index - b.order_index);
  stops = buildTripStops(loaded);
  setLoading(false);
  clearProblem();

  if (mode === 'public') {
    // Do NOT call navbar.setDestinations() here — its links use tripId= which would be broken
    // URLs for guests. The guest view uses the default navbar.
    document.querySelectorAll('[data-owner-only]').forEach((el) => el.setAttribute('hidden', ''));
  } else {
    wireOwnerControls(loaded);
  }
  showView(parseTripLocation(window.location.search).destIndex, false);
}

function wireOwnerControls(t: ApiTrip): void {
  const editLink = byId<HTMLAnchorElement>('trip-edit-link');
  if (editLink) {
    editLink.href = `trip-edit.html?tripId=${encodeURIComponent(t.id)}`;
    editLink.removeAttribute('hidden');
  }

  // Copy-link button only for public trips with a slug
  const copyLinkBtn = byId<HTMLButtonElement>('copy-link-btn');
  if (copyLinkBtn && t.is_public && t.public_slug) {
    copyLinkBtn.removeAttribute('hidden');
    const url = `${window.location.origin}${window.location.pathname}?slug=${encodeURIComponent(t.public_slug)}`;
    copyLinkBtn.addEventListener('click', async () => {
      let label = 'Copied!';
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        label = 'Could not copy';
      }
      setText(copyLinkBtn, label);
      announceToScreenReader(label);
      setTimeout(() => { setText(copyLinkBtn, 'Copy public link'); }, 2000);
    });
  }

  // Update navbar with this trip's destinations
  const navbar = document.querySelector('travel-nav');
  if (navbar && 'setDestinations' in navbar) {
    (navbar as unknown as { setDestinations(d: unknown[]): void }).setDestinations(
      // Navbar.ts interpolates `label` into innerHTML, so hand it escaped text (city names are user input).
      destinations.map((d, i) => ({ id: d.id, label: escapeHtml(d.city_name), tripId: t.id, index: i })),
    );
  }
}

// ---------------------------------------------------------------------------
// Main init
// ---------------------------------------------------------------------------

function init(): void {
  initTheme();
  installGlobalErrorHandler();

  window.addEventListener('theme-changed', () => {
    if (cityTileLayer) {
      cityTileLayer = switchBaseMapTheme(cityTileLayer);
      window.currentTileLayer = cityTileLayer;
    }
  });
  window.addEventListener('popstate', () => {
    showView(parseTripLocation(window.location.search).destIndex, false);
  });
  byId('trip-card')?.addEventListener('click', onCardClick);
  byId('trip-slow-retry')?.addEventListener('click', () => { void loadTrip(); });

  const loc = parseTripLocation(window.location.search);
  ref = { tripId: loc.tripId, slug: loc.slug };

  // Public slug mode: skip auth entirely, load via slug directly.
  if (loc.slug) {
    mode = 'public';
    void loadTrip();
    document.body.classList.add('ready');
    return;
  }

  if (!loc.tripId) {
    showError({ title: 'No trip specified', message: 'No trip specified. Check the URL.', retryable: false });
    return;
  }

  // Owner view needs auth. Bounded: 'unavailable' after a few seconds at most, and a late
  // answer (or Retry) still lands here exactly once.
  mode = 'owner';
  showAuthPending();
  let started = false;
  watchAuth({
    authenticated: () => {
      hideAuthPending();
      clearAuthUnavailableState();
      if (started) return;
      started = true;
      void loadTrip();
    },
    anonymous: () => {
      hideAuthPending();
      clearAuthUnavailableState();
      if (started) return;
      showError(
        { title: 'Sign in to see this trip', message: "You don't have access to this trip. Ask the owner for the public link.", retryable: false },
        { signedOut: true },
      );
      showSignUpNotice(takeSignUpOutcome(false));
    },
    unavailable: () => {
      if (!started) showAuthUnavailableState();
    },
  });
  document.body.classList.add('ready');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
