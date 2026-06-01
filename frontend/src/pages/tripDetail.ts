/**
 * Trip Detail Page
 *
 * Dynamic, data-driven trip view that replaces the 8 static city pages.
 * Reads `tripId` from the URL query string, loads the trip from the API,
 * converts it to the legacy CityData format, and initialises the map/legend.
 *
 * URL format: trip.html?tripId=<uuid>
 * Optionally: trip.html?tripId=<uuid>&destIndex=<number>
 */

import '@/styles/main.css';
import '@/components/Navbar';
import '@/components/SearchBar';

import * as L from 'leaflet';
import { initTheme, getThemeConfig } from '@/modules/theme';
import { initKeycloak, isAuthenticated } from '@/auth/keycloak';
import { getTrip, getPublicTrip } from '@/api/client';
import { apiTripToCityData } from '@/modules/tripAdapter';
import { getMapsUrl } from '@/data/maps';
import { createDirectionsUrl, announceToScreenReader } from '@/modules/utils';
import type { ApiTrip, CityData, Activity, Day, Hotel } from '@/types';
import DOMPurify from 'dompurify';
import { setText, setStyle } from '@/modules/dom';
import { installGlobalErrorHandler } from '@/modules/toast';

// ---------------------------------------------------------------------------
// URL params
// ---------------------------------------------------------------------------

function getUrlParams(): { tripId: string | null; slug: string | null; destIndex: number } {
  const params = new URLSearchParams(window.location.search);
  return {
    tripId: params.get('tripId'),
    slug: params.get('slug'),
    destIndex: parseInt(params.get('destIndex') ?? '0', 10) || 0,
  };
}

// ---------------------------------------------------------------------------
// Destination tab rendering
// ---------------------------------------------------------------------------

function buildDestTabs(trip: ApiTrip, activeIndex: number): void {
  const tabsEl = document.getElementById('dest-tabs');
  if (!tabsEl) return;

  tabsEl.setAttribute('role', 'tablist');
  tabsEl.setAttribute('aria-label', 'Trip destinations');

  const sorted = trip.destinations.slice().sort((a, b) => a.order_index - b.order_index);

  tabsEl.innerHTML = '';
  sorted.forEach((dest, i) => {
    const btn = document.createElement('button');
    btn.className = 'dest-tab' + (i === activeIndex ? ' is-active' : '');
    btn.dataset.destIndex = String(i);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(i === activeIndex));
    setText(btn, dest.city_name);
    tabsEl.appendChild(btn);
  });

  tabsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.dest-tab') as HTMLElement | null;
    if (!btn) return;
    const idx = parseInt(btn.dataset.destIndex ?? '0', 10);
    const url = new URL(window.location.href);
    url.searchParams.set('destIndex', String(idx));
    window.history.pushState({}, '', url.toString());
    loadDestination(trip, idx);
  });
}

// ---------------------------------------------------------------------------
// Map initialisation (mirrors map.ts logic but fully self-contained)
// ---------------------------------------------------------------------------

let currentMap: L.Map | null = null;
let currentTileLayer: L.TileLayer | null = null;

function destroyMap(): void {
  if (currentMap) {
    currentMap.remove();
    currentMap = null;
    currentTileLayer = null;
  }
}

function createMarkerIcon(label: string | number, color: string, isOptional = false): L.DivIcon {
  const cls = isOptional ? 'numbered-marker optional' : 'numbered-marker';
  const div = document.createElement('div');
  div.className = cls;
  setStyle(div, 'background', color);
  div.textContent = String(label);
  return L.divIcon({
    className: 'custom-marker',
    html: div,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function createHotelIcon(): L.DivIcon {
  return L.divIcon({
    className: 'custom-marker',
    html: '<div class="hotel-marker">H</div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

export function buildPopup(activity: Activity, day: Day, mapsUrl: string | null): string {
  const badge = activity.optional ? `<span class="optional-badge">Option ${activity.optional}</span>` : '';
  let html = `<div class="day-label">${day.label}${badge}</div><h4>${activity.name}</h4>`;
  if (activity.notes) html += `<p>${activity.notes}</p>`;
  if (!activity.isGeneric && mapsUrl && activity.coords) {
    const dirUrl = createDirectionsUrl(activity.coords);
    html += `<div class="popup-links">
      <a href="${mapsUrl}" target="_blank" rel="noopener" class="popup-link">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span>View on Maps</span>
      </a>
      <a href="${dirUrl}" target="_blank" rel="noopener" class="popup-link directions">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
        <span>Directions</span>
      </a>
    </div>`;
  }
  return DOMPurify.sanitize(html);
}

export function buildHotelPopup(hotel: Hotel, mapsUrl: string | null): string {
  let html = `<h4>${hotel.name}</h4><p>Accommodation</p>`;
  if (mapsUrl && hotel.coords) {
    const dirUrl = createDirectionsUrl(hotel.coords);
    html += `<div class="popup-links">
      <a href="${mapsUrl}" target="_blank" rel="noopener" class="popup-link">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span>View on Maps</span>
      </a>
      <a href="${dirUrl}" target="_blank" rel="noopener" class="popup-link directions">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
        <span>Directions</span>
      </a>
    </div>`;
  }
  return DOMPurify.sanitize(html);
}

function initMap(data: CityData): void {
  destroyMap();

  const themeConfig = getThemeConfig();
  const map = L.map('map', { zoomControl: true, attributionControl: false, keyboard: true }).setView(
    data.center,
    data.zoom
  );
  currentTileLayer = L.tileLayer(themeConfig.tileUrl, { maxZoom: 19 }).addTo(map);
  currentMap = map;
  window.currentMap = map;
  window.currentTileLayer = currentTileLayer;

  const markersByDay: Record<string, L.Marker[]> = {};
  const allMarkers: L.Marker[] = [];
  const daySelector = document.getElementById('day-selector');

  if (daySelector) {
    daySelector.setAttribute('role', 'tablist');
    daySelector.setAttribute('aria-label', 'Filter by day');
    daySelector.innerHTML = '';

    Object.entries(data.days).forEach(([dateKey, day]) => {
      const btn = document.createElement('button');
      btn.className = 'day-btn' + (day.hasOptions ? ' has-options' : '');
      btn.textContent = day.label;
      btn.dataset.day = dateKey;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', 'false');
      if (day.hasOptions) btn.title = 'This day has alternative options';
      daySelector.appendChild(btn);

      markersByDay[dateKey] = [];
      day.activities.forEach((activity, idx) => {
        if (!activity.coords) return;
        const isOptional = !!activity.optional;
        const markerLabel = isOptional ? activity.optional! : idx + 1;
        const markerColor = isOptional ? '#af52de' : day.color;
        const marker = L.marker(activity.coords, {
          icon: createMarkerIcon(markerLabel, markerColor, isOptional),
          alt: activity.name,
        });
        marker.bindPopup(buildPopup(activity, day, getMapsUrl(activity.name)));
        markersByDay[dateKey].push(marker);
        allMarkers.push(marker);
      });
    });
  }

  if (data.hotel?.coords) {
    const hotelMapsUrl = getMapsUrl(data.hotel.name);
    L.marker(data.hotel.coords, { icon: createHotelIcon(), alt: data.hotel.name })
      .bindPopup(buildHotelPopup(data.hotel, hotelMapsUrl))
      .addTo(map);
  }

  allMarkers.forEach((m) => m.addTo(map));
  setupDayFilter(daySelector, map, data, markersByDay, allMarkers);

  const hotelBtn = document.getElementById('hotel-btn');
  if (hotelBtn && data.hotel?.coords) {
    hotelBtn.setAttribute('aria-label', 'Center map on hotel');
    hotelBtn.onclick = () => map.setView(data.hotel.coords, 15);
  }

  generateLegend(data);

  window.addEventListener('theme-changed', () => {
    if (!currentMap || !currentTileLayer) return;
    const cfg = getThemeConfig();
    currentMap.removeLayer(currentTileLayer);
    currentTileLayer = L.tileLayer(cfg.tileUrl, { maxZoom: 19 }).addTo(currentMap);
    window.currentTileLayer = currentTileLayer;
  });

  announceToScreenReader(`Map of ${data.name} loaded with ${allMarkers.length} locations`);
}

// ---------------------------------------------------------------------------
// Day filter (mirrors map.ts setupDayFilter)
// ---------------------------------------------------------------------------

function setupDayFilter(
  daySelector: HTMLElement | null,
  map: L.Map,
  data: CityData,
  markersByDay: Record<string, L.Marker[]>,
  allMarkers: L.Marker[]
): void {
  if (!daySelector) return;
  let activeDay: string | null = null;

  daySelector.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('day-btn')) return;
    const selectedDay = target.dataset.day!;

    if (activeDay === selectedDay) {
      activeDay = null;
      daySelector.querySelectorAll('.day-btn').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      allMarkers.forEach((m) => m.addTo(map));
      map.setView(data.center, data.zoom);
      document.querySelectorAll('.day-group').forEach((g) => {
        (g as HTMLElement).style.display = 'block';
      });
      announceToScreenReader('Showing all days');
      return;
    }

    activeDay = selectedDay;
    daySelector.querySelectorAll('.day-btn').forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    target.classList.add('active');
    target.setAttribute('aria-selected', 'true');
    allMarkers.forEach((m) => map.removeLayer(m));
    markersByDay[selectedDay].forEach((m) => m.addTo(map));

    if (markersByDay[selectedDay].length > 0) {
      const bounds = L.featureGroup(markersByDay[selectedDay]).getBounds();
      map.fitBounds(bounds.pad(0.3));
    }

    document.querySelectorAll('.day-group').forEach((g) => {
      (g as HTMLElement).style.display =
        (g as HTMLElement).dataset.day === selectedDay ? 'block' : 'none';
    });
    const dayData = data.days[selectedDay];
    if (!dayData) return;
    announceToScreenReader(
      `Showing ${dayData.label}: ${markersByDay[selectedDay].length} locations`
    );
  });
}

// ---------------------------------------------------------------------------
// Legend (mirrors map.ts generateLegendByDay)
// ---------------------------------------------------------------------------

function generateLegend(data: CityData): void {
  const legendGrid = document.getElementById('legend-grid');
  if (!legendGrid) return;
  legendGrid.innerHTML = '';
  legendGrid.setAttribute('role', 'region');
  legendGrid.setAttribute('aria-label', 'Activity list by day');

  Object.entries(data.days).forEach(([dateKey, day]) => {
    const dayGroup = document.createElement('div');
    dayGroup.className = 'day-group' + (day.hasOptions ? ' has-options' : '');
    dayGroup.dataset.day = dateKey;
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
    list.setAttribute('role', 'list');
    day.activities.forEach((act, idx) => list.appendChild(buildLegendItem(act, idx, day)));
    dayGroup.appendChild(list);
    legendGrid.appendChild(dayGroup);
  });

  updateHotelInfo(data.hotel);
}

function buildLegendItem(activity: Activity, idx: number, day: Day): HTMLElement {
  const isOptional = !!activity.optional;
  const markerLabel = isOptional ? activity.optional! : idx + 1;
  const markerColor = isOptional ? '#af52de' : day.color;
  const mapsUrl = getMapsUrl(activity.name);
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
  setText(nameEl, activity.name);
  contentDiv.appendChild(nameEl);
  if (noteText) {
    const noteEl = document.createElement('small');
    setText(noteEl, noteText);
    contentDiv.appendChild(noteEl);
  }
  item.appendChild(contentDiv);

  if (!activity.isGeneric && mapsUrl && activity.coords) {
    const dirUrl = createDirectionsUrl(activity.coords);
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'legend-actions';
    const mapsLink = document.createElement('a');
    mapsLink.href = mapsUrl;
    mapsLink.target = '_blank';
    mapsLink.rel = 'noopener';
    mapsLink.className = 'legend-action-btn';
    mapsLink.title = 'View on Google Maps';
    mapsLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';
    actionsDiv.appendChild(mapsLink);
    const dirLink = document.createElement('a');
    dirLink.href = dirUrl;
    dirLink.target = '_blank';
    dirLink.rel = 'noopener';
    dirLink.className = 'legend-action-btn directions';
    dirLink.title = 'Directions';
    dirLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>';
    actionsDiv.appendChild(dirLink);
    item.appendChild(actionsDiv);
  }

  return item;
}

function updateHotelInfo(hotel: Hotel): void {
  const hotelInfo = document.getElementById('hotel-info');
  if (!hotelInfo || !hotel) return;
  const mapsUrl = getMapsUrl(hotel.name);

  hotelInfo.innerHTML = '';
  const markerDiv = document.createElement('div');
  markerDiv.className = 'marker';
  markerDiv.textContent = 'H';
  hotelInfo.appendChild(markerDiv);

  const nameSpan = document.createElement('span');
  setText(nameSpan, hotel.name);
  hotelInfo.appendChild(nameSpan);

  if (mapsUrl && hotel.coords) {
    const dirUrl = createDirectionsUrl(hotel.coords);
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'legend-actions';
    const mapsLink = document.createElement('a');
    mapsLink.href = mapsUrl;
    mapsLink.target = '_blank';
    mapsLink.rel = 'noopener';
    mapsLink.className = 'legend-action-btn';
    mapsLink.title = 'View on Google Maps';
    mapsLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';
    actionsDiv.appendChild(mapsLink);
    const dirLink = document.createElement('a');
    dirLink.href = dirUrl;
    dirLink.target = '_blank';
    dirLink.rel = 'noopener';
    dirLink.className = 'legend-action-btn directions';
    dirLink.title = 'Directions';
    dirLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>';
    actionsDiv.appendChild(dirLink);
    hotelInfo.appendChild(actionsDiv);
  }

  const legend = document.querySelector('.legend');
  if (legend) legend.insertBefore(hotelInfo, legend.firstChild);
}

// ---------------------------------------------------------------------------
// Load destination
// ---------------------------------------------------------------------------

function loadDestination(trip: ApiTrip, destIndex: number): void {
  const cities = apiTripToCityData(trip);
  const data = cities[destIndex] ?? cities[0];
  if (!data) return;

  // Update page header
  const titleEl = document.getElementById('trip-title');
  const subtitleEl = document.getElementById('trip-subtitle');
  if (titleEl) titleEl.textContent = trip.name;
  if (subtitleEl) subtitleEl.textContent = `${data.name} · ${data.dates}`;

  // Activate tab
  document.querySelectorAll('.dest-tab').forEach((btn, i) => {
    const active = i === destIndex;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  // Init map for this destination's CityData
  initMap(data);
}

// ---------------------------------------------------------------------------
// Error rendering
// ---------------------------------------------------------------------------

function showError(message: string): void {
  const main = document.getElementById('main-content');
  if (!main) return;
  main.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'page-card';
  card.style.padding = '32px';
  card.style.textAlign = 'center';
  const p = document.createElement('p');
  p.style.color = 'var(--jp-text-secondary,#515154)';
  setText(p, message);
  card.appendChild(p);
  const link = document.createElement('a');
  link.href = 'dashboard.html';
  link.style.color = 'var(--jp-accent,#0071e3)';
  link.textContent = 'Back to dashboard';
  card.appendChild(link);
  main.appendChild(card);
}

// ---------------------------------------------------------------------------
// Main init
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  initTheme();
  installGlobalErrorHandler();

  const { tripId, slug, destIndex } = getUrlParams();

  // Public slug mode: skip auth entirely, load via slug directly
  if (slug) {
    let slugTrip: ApiTrip | null = null;
    try {
      slugTrip = await getPublicTrip(slug);
    } catch (err) {
      showError(`Could not load trip: ${(err as Error).message}`);
      document.body.classList.add('ready');
      return;
    }
    buildDestTabs(slugTrip, destIndex);
    loadDestination(slugTrip, destIndex);
    // Hide all owner-only controls — this is a public guest view.
    // Do NOT call navbar.setDestinations() here — its links use tripId= which
    // would produce broken URLs for guests. Guest view uses the default navbar.
    document.querySelectorAll('[data-owner-only]').forEach((el) => {
      (el as HTMLElement).setAttribute('hidden', '');
    });
    document.body.classList.add('ready');
    return;
  }

  if (!tripId) {
    showError('No trip specified. Check the URL.');
    document.body.classList.add('ready');
    return;
  }

  // Try to auth silently
  let authenticated = false;
  try {
    authenticated = await initKeycloak();
  } catch {
    // Continue unauthenticated
  }

  let trip: ApiTrip | null = null;

  // First try authenticated fetch, then fall back to public
  if (authenticated && isAuthenticated()) {
    try {
      trip = await getTrip(tripId);
    } catch {
      // Fall through to public
    }
  }

  if (!trip) {
    showError("You don't have access to this trip. Ask the owner for the public link.");
    document.body.classList.add('ready');
    return;
  }

  buildDestTabs(trip, destIndex);
  loadDestination(trip, destIndex);

  // Reveal the edit link for authenticated owners
  const editLink = document.getElementById('trip-edit-link') as HTMLAnchorElement | null;
  if (editLink && authenticated) {
    editLink.href = `trip-edit.html?tripId=${trip.id}`;
    editLink.removeAttribute('hidden');
  }

  // Reveal copy-link button only for public trips with a slug
  const copyLinkBtn = document.getElementById('copy-link-btn') as HTMLButtonElement | null;
  if (copyLinkBtn && trip.is_public && trip.public_slug) {
    copyLinkBtn.removeAttribute('hidden');
    const slugForCopy = trip.public_slug;
    copyLinkBtn.addEventListener('click', async () => {
      const url = `${window.location.origin}${window.location.pathname}?slug=${slugForCopy}`;
      await navigator.clipboard.writeText(url);
      setText(copyLinkBtn, 'Copied!');
      setTimeout(() => { setText(copyLinkBtn, 'Copy public link'); }, 2000);
    });
  }

  // Update navbar with this trip's destinations
  const navbar = document.querySelector('travel-nav');
  if (navbar && 'setDestinations' in navbar) {
    (navbar as any).setDestinations(
      trip.destinations
        .slice()
        .sort((a, b) => a.order_index - b.order_index)
        .map((d, i) => ({
          id: d.id,
          label: d.city_name,
          tripId: trip.id,
          index: i,
        }))
    );
  }

  document.body.classList.add('ready');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
