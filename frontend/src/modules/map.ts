import * as L from 'leaflet';
import type { Activity, Day, Hotel, CityData, CityMarker } from '@/types';
import { ITINERARY } from '@/data/itinerary';
import { getMapsUrl } from '@/data/maps';
import { getTheme, getThemeConfig } from './theme';
import { createDirectionsUrl, announceToScreenReader } from './utils';
import DOMPurify from 'dompurify';
import { setText, setStyle } from '@/modules/dom';

let currentTileLayer: L.TileLayer | null = null;

export function centerNavOnActive(): void {
  const nav = document.querySelector('.top-nav') as HTMLElement | null;
  const activeItem = nav?.querySelector('.is-active') as HTMLElement | null;
  if (!nav || !activeItem) return;
  const navRect = nav.getBoundingClientRect();
  const activeRect = activeItem.getBoundingClientRect();
  const scrollLeft = activeItem.offsetLeft - (navRect.width / 2) + (activeRect.width / 2);
  nav.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' });
}

export function moveHotelInfo(): void {
  const legend = document.querySelector('.legend');
  const hotelInfo = document.getElementById('hotel-info');
  if (legend && hotelInfo) legend.insertBefore(hotelInfo, legend.firstChild);
}

function createMarkerIcon(label: string | number, color: string, isOptional = false): L.DivIcon {
  const markerClass = isOptional ? 'numbered-marker optional' : 'numbered-marker';
  const div = document.createElement('div');
  div.className = markerClass;
  setStyle(div, 'background', color);
  div.textContent = String(label);
  return L.divIcon({
    className: 'custom-marker',
    html: div,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

function createHotelIcon(): L.DivIcon {
  return L.divIcon({
    className: 'custom-marker',
    html: '<div class="hotel-marker">H</div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}

export function createPopupContent(activity: Activity, day: Day, mapsUrl: string | null): string {
  const optionalBadge = activity.optional ? `<span class="optional-badge">Option ${activity.optional}</span>` : '';
  let content = `<div class="day-label">${day.label}${optionalBadge}</div><h4>${activity.name}</h4>`;
  if (activity.notes) content += `<p>${activity.notes}</p>`;
  if (!activity.isGeneric && mapsUrl && activity.coords) {
    const directionsUrl = createDirectionsUrl(activity.coords);
    content += `<div class="popup-links"><a href="${mapsUrl}" target="_blank" rel="noopener" class="popup-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg><span>View on Maps</span></a><a href="${directionsUrl}" target="_blank" rel="noopener" class="popup-link directions"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg><span>Directions</span></a></div>`;
  }
  return DOMPurify.sanitize(content);
}

export function createHotelPopup(hotel: Hotel, mapsUrl: string | null): string {
  let content = `<h4>${hotel.name}</h4><p>Accommodation</p>`;
  if (mapsUrl && hotel.coords) {
    const directionsUrl = createDirectionsUrl(hotel.coords);
    content += `<div class="popup-links"><a href="${mapsUrl}" target="_blank" rel="noopener" class="popup-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg><span>View on Maps</span></a><a href="${directionsUrl}" target="_blank" rel="noopener" class="popup-link directions"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg><span>Directions</span></a></div>`;
  }
  return DOMPurify.sanitize(content);
}

export function initCityMap(city: string): L.Map | null {
  const data = ITINERARY[city];
  if (!data) return null;

  const themeConfig = getThemeConfig();
  const map = L.map('map', { zoomControl: true, attributionControl: false, keyboard: true })
    .setView(data.center, data.zoom);
  
  currentTileLayer = L.tileLayer(themeConfig.tileUrl, { maxZoom: 19 }).addTo(map);
  window.currentMap = map;
  window.currentTileLayer = currentTileLayer;

  const markersByDay: Record<string, L.Marker[]> = {};
  const allMarkers: L.Marker[] = [];
  const daySelector = document.getElementById('day-selector');

  if (daySelector) {
    daySelector.setAttribute('role', 'tablist');
    daySelector.setAttribute('aria-label', 'Filter by day');
    
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
        const markerLabel = isOptional ? activity.optional! : (idx + 1);
        const markerColor = isOptional ? '#af52de' : day.color;
        const marker = L.marker(activity.coords, { icon: createMarkerIcon(markerLabel, markerColor, isOptional), alt: activity.name });
        const mapsUrl = getMapsUrl(activity.name);
        marker.bindPopup(createPopupContent(activity, day, mapsUrl));
        markersByDay[dateKey].push(marker);
        allMarkers.push(marker);
      });
    });
  }

  if (data.hotel?.coords) {
    const hotelMapsUrl = getMapsUrl(data.hotel.name);
    L.marker(data.hotel.coords, { icon: createHotelIcon(), alt: data.hotel.name })
      .bindPopup(createHotelPopup(data.hotel, hotelMapsUrl))
      .addTo(map);
  }

  allMarkers.forEach(m => m.addTo(map));
  setupDayFilter(daySelector, map, data, markersByDay, allMarkers);

  const hotelBtn = document.getElementById('hotel-btn');
  if (hotelBtn && data.hotel?.coords) {
    hotelBtn.setAttribute('aria-label', 'Center map on hotel');
    hotelBtn.addEventListener('click', () => map.setView(data.hotel.coords, 15));
  }

  generateLegendByDay(data);
  moveHotelInfo();
  
  // Check URL parameters for auto-focus and day selection
  const urlParams = new URLSearchParams(window.location.search);
  const dayParam = urlParams.get('day');
  const activityParam = urlParams.get('activity');
  
  if (dayParam && activityParam) {
    // Wait for map to be fully initialized
    setTimeout(() => {
      selectDayAndFocusActivity(dayParam, activityParam, daySelector, map, data, markersByDay);
    }, 300);
  }
  
  announceToScreenReader(`Map of ${data.name} loaded with ${allMarkers.length} locations`);
  return map;
}

function selectDayAndFocusActivity(
  dayKey: string, 
  activityName: string, 
  daySelector: HTMLElement | null,
  map: L.Map,
  data: CityData,
  markersByDay: Record<string, L.Marker[]>
): void {
  if (!daySelector || !markersByDay[dayKey]) return;
  
  // Find and click the day button
  const dayBtn = daySelector.querySelector(`[data-day="${dayKey}"]`) as HTMLElement;
  if (dayBtn) {
    dayBtn.click();
  }
  
  // Find the activity marker and open its popup
  const dayData = data.days[dayKey];
  if (dayData) {
    const activityIndex = dayData.activities.findIndex(a => a.name === activityName);
    if (activityIndex >= 0 && markersByDay[dayKey][activityIndex]) {
      const marker = markersByDay[dayKey][activityIndex];
      
      // Focus on the marker
      setTimeout(() => {
        map.setView(marker.getLatLng(), 15);
        marker.openPopup();
        
        // Clean URL (remove parameters)
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
      }, 500);
    }
  }
}

function setupDayFilter(
  daySelector: HTMLElement | null, map: L.Map, data: CityData,
  markersByDay: Record<string, L.Marker[]>, allMarkers: L.Marker[]
): void {
  if (!daySelector) return;
  let activeDay: string | null = null;

  daySelector.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('day-btn')) return;
    const selectedDay = target.dataset.day!;
    
    if (activeDay === selectedDay) {
      activeDay = null;
      document.querySelectorAll('.day-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      allMarkers.forEach(m => m.addTo(map));
      map.setView(data.center, data.zoom);
      document.querySelectorAll('.day-group').forEach(g => { (g as HTMLElement).style.display = 'block'; });
      announceToScreenReader('Showing all days');
      return;
    }
    
    activeDay = selectedDay;
    document.querySelectorAll('.day-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    target.classList.add('active');
    target.setAttribute('aria-selected', 'true');
    allMarkers.forEach(m => map.removeLayer(m));
    markersByDay[selectedDay].forEach(m => m.addTo(map));
    
    if (markersByDay[selectedDay].length > 0) {
      const bounds = L.featureGroup(markersByDay[selectedDay]).getBounds();
      map.fitBounds(bounds.pad(0.3));
    }
    
    document.querySelectorAll('.day-group').forEach(g => {
      (g as HTMLElement).style.display = (g as HTMLElement).dataset.day === selectedDay ? 'block' : 'none';
    });
    const dayData = data.days[selectedDay];
    announceToScreenReader(`Showing ${dayData.label}: ${markersByDay[selectedDay].length} locations`);
  });
}

function generateLegendByDay(data: CityData): void {
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
    const activitiesList = document.createElement('ul');
    activitiesList.className = 'day-activities';
    activitiesList.setAttribute('role', 'list');
    day.activities.forEach((activity, idx) => activitiesList.appendChild(createLegendItem(activity, idx, day)));
    dayGroup.appendChild(activitiesList);
    legendGrid.appendChild(dayGroup);
  });
  updateHotelInfo(data.hotel);
}

function createLegendItem(activity: Activity, idx: number, day: Day): HTMLElement {
  const isOptional = !!activity.optional;
  const markerLabel = isOptional ? activity.optional! : (idx + 1);
  const markerColor = isOptional ? '#af52de' : day.color;
  const mapsUrl = getMapsUrl(activity.name);
  const item = document.createElement('li');
  item.className = 'legend-item' + (isOptional ? ' is-optional' : '');
  const noteText = activity.notes ? (activity.notes.length > 50 ? activity.notes.substring(0, 50) + '...' : activity.notes) : '';
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
    const directionsUrl = createDirectionsUrl(activity.coords);
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
    dirLink.href = directionsUrl;
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
    const directionsUrl = createDirectionsUrl(hotel.coords);
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
    dirLink.href = directionsUrl;
    dirLink.target = '_blank';
    dirLink.rel = 'noopener';
    dirLink.className = 'legend-action-btn directions';
    dirLink.title = 'Directions';
    dirLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>';
    actionsDiv.appendChild(dirLink);
    hotelInfo.appendChild(actionsDiv);
  }
}

export function initOverviewMap(): void {
  const theme = getTheme();
  const themeConfig = getThemeConfig(theme);
  const map = L.map('map', { zoomControl: true, attributionControl: false, keyboard: true })
    .setView([35.5, 137.0], 6);
  
  currentTileLayer = L.tileLayer(themeConfig.tileUrl, { maxZoom: 19 }).addTo(map);
  window.currentMap = map;
  window.currentTileLayer = currentTileLayer;

  const cities: CityMarker[] = [
    { name: 'Tokyo', coords: [35.6762, 139.7050], dates: '22 Feb – 1 Mar', color: '#ff3b30', link: 'tokyo.html' },
    { name: 'Nagoya', coords: [35.1815, 136.9066], dates: '2–3 Mar', color: '#ff9500', link: 'nagoya.html' },
    { name: 'Takayama', coords: [36.1400, 137.2500], dates: '4–7 Mar', color: '#ffcc00', link: 'takayama.html' },
    { name: 'Kyoto', coords: [35.0116, 135.7681], dates: '8–13 Mar', color: '#34c759', link: 'kyoto.html' },
    { name: 'Osaka', coords: [34.6937, 135.5023], dates: '14–17 Mar', color: '#5ac8fa', link: 'osaka.html' },
    { name: 'Naoshima', coords: [34.4600, 133.9950], dates: '18–19 Mar', color: '#007aff', link: 'naoshima.html' },
    { name: 'Hakone', coords: [35.2330, 139.1070], dates: '20–21 Mar', color: '#af52de', link: 'hakone.html' },
    { name: 'Tokyo', coords: [35.6862, 139.7150], dates: '22–23 Mar', color: '#ff2d55', link: 'tokyo2.html' }
  ];

  cities.forEach((city, idx) => {
    const markerDiv = document.createElement('div');
    markerDiv.className = 'numbered-marker';
    setStyle(markerDiv, 'background', city.color);
    setStyle(markerDiv, 'width', '32px');
    setStyle(markerDiv, 'height', '32px');
    setStyle(markerDiv, 'font-size', '13px');
    markerDiv.textContent = String(idx + 1);
    const icon = L.divIcon({
      className: 'custom-marker',
      html: markerDiv,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    const popupHtml = `<h4>${city.name}</h4><p>${city.dates}</p><p><a href="${city.link}" style="color:var(--accent);">View itinerary</a></p>`;
    L.marker(city.coords as L.LatLngExpression, { icon, alt: city.name })
      .bindPopup(DOMPurify.sanitize(popupHtml))
      .addTo(map);
  });

  L.polyline(cities.map(c => c.coords as L.LatLngExpression), {
    color: themeConfig.routeColor, weight: 2, opacity: 0.5, dashArray: '8, 8'
  }).addTo(map);
  
  announceToScreenReader('Overview map loaded with 8 cities');
}

export function updateMapTheme(): void {
  if (!window.currentMap || !window.currentTileLayer) return;
  const themeConfig = getThemeConfig();
  window.currentMap.removeLayer(window.currentTileLayer);
  window.currentTileLayer = L.tileLayer(themeConfig.tileUrl, { maxZoom: 19 }).addTo(window.currentMap);
}
