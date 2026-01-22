// Map Module - Leaflet integration
import { ITINERARY, getMapsUrl } from './config.js';

let currentMap = null, currentTileLayer = null;

export function centerNavOnActive() {
  const nav = document.querySelector('.top-nav');
  const activeItem = nav?.querySelector('.is-active');
  if (!nav || !activeItem) return;
  const navRect = nav.getBoundingClientRect();
  const activeRect = activeItem.getBoundingClientRect();
  nav.scrollTo({ left: Math.max(0, activeItem.offsetLeft - (navRect.width / 2) + (activeRect.width / 2)), behavior: 'smooth' });
}

export function moveHotelInfo() {
  const legend = document.querySelector('.legend');
  const hotelInfo = document.getElementById('hotel-info');
  if (legend && hotelInfo) legend.insertBefore(hotelInfo, legend.firstChild);
}

export function initCityMap(city) {
  const data = ITINERARY[city];
  if (!data) return;

  const theme = document.documentElement.getAttribute('data-theme');
  const tileUrl = theme === 'dark' ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  const map = L.map('map', { zoomControl: true, attributionControl: false }).setView(data.center, data.zoom);
  currentTileLayer = L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);
  currentMap = map;
  window.currentMap = map;
  window.currentTileLayer = currentTileLayer;

  const markersByDay = {};
  const allMarkers = [];

  const daySelector = document.getElementById('day-selector');
  if (daySelector) {
    Object.keys(data.days).forEach((dateKey) => {
      const day = data.days[dateKey];
      const btn = document.createElement('button');
      btn.className = 'day-btn' + (day.hasOptions ? ' has-options' : '');
      btn.textContent = day.label;
      btn.dataset.day = dateKey;
      if (day.hasOptions) btn.title = 'Este día tiene opciones alternativas';
      daySelector.appendChild(btn);

      markersByDay[dateKey] = [];

      day.activities.forEach((activity, idx) => {
        if (!activity.coords) return;
        const isOptional = !!activity.optional;
        const markerClass = isOptional ? 'numbered-marker optional' : 'numbered-marker';
        const markerLabel = isOptional ? activity.optional : (idx + 1);

        const marker = L.marker(activity.coords, {
          icon: L.divIcon({
            className: 'custom-marker',
            html: `<div class="${markerClass}" style="background:${isOptional ? '#af52de' : day.color}">${markerLabel}</div>`,
            iconSize: [28, 28], iconAnchor: [14, 14]
          })
        });

        let popup = `<div class="day-label">${day.label}${isOptional ? '<span class="optional-badge">Opción ' + activity.optional + '</span>' : ''}</div><h4>${activity.name}</h4>`;
        if (activity.notes) popup += `<p>${activity.notes}</p>`;
        const mapsUrl = getMapsUrl(activity.name);
        if (!activity.isGeneric && mapsUrl) {
          popup += `<div class="popup-links"><a href="${mapsUrl}" target="_blank" rel="noopener" class="popup-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> Ver en Maps</a><a href="${mapsUrl}" target="_blank" rel="noopener" class="popup-link directions"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg> Cómo llegar</a></div>`;
        }
        marker.bindPopup(popup);
        markersByDay[dateKey].push(marker);
        allMarkers.push(marker);
      });
    });
  }

  // Hotel marker
  if (data.hotel?.coords) {
    const hotelMapsUrl = getMapsUrl(data.hotel.name);
    let hotelPopup = `<h4>${data.hotel.name}</h4><p>Alojamiento</p>`;
    if (hotelMapsUrl) hotelPopup += `<div class="popup-links"><a href="${hotelMapsUrl}" target="_blank" rel="noopener" class="popup-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> Ver en Maps</a><a href="${hotelMapsUrl}" target="_blank" rel="noopener" class="popup-link directions"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg> Cómo llegar</a></div>`;
    L.marker(data.hotel.coords, { icon: L.divIcon({ className: 'custom-marker', html: `<div class="hotel-marker">H</div>`, iconSize: [32, 32], iconAnchor: [16, 16] }) }).bindPopup(hotelPopup).addTo(map);
  }

  allMarkers.forEach(m => m.addTo(map));

  // Day filter
  let activeDay = null;
  if (daySelector) {
    daySelector.addEventListener('click', (e) => {
      if (!e.target.classList.contains('day-btn')) return;
      const selectedDay = e.target.dataset.day;
      if (activeDay === selectedDay) {
        activeDay = null;
        document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
        allMarkers.forEach(m => m.addTo(map));
        map.setView(data.center, data.zoom);
        document.querySelectorAll('.day-group').forEach(g => g.style.display = 'block');
        return;
      }
      activeDay = selectedDay;
      document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      allMarkers.forEach(m => map.removeLayer(m));
      markersByDay[selectedDay].forEach(m => m.addTo(map));
      if (markersByDay[selectedDay].length > 0) map.fitBounds(L.featureGroup(markersByDay[selectedDay]).getBounds().pad(0.3));
      document.querySelectorAll('.day-group').forEach(g => g.style.display = g.dataset.day === selectedDay ? 'block' : 'none');
    });
  }

  // Hotel button
  const hotelBtn = document.getElementById('hotel-btn');
  if (hotelBtn && data.hotel?.coords) hotelBtn.addEventListener('click', () => map.setView(data.hotel.coords, 15));

  generateLegendByDay(data);
  moveHotelInfo();
  return map;
}

function generateLegendByDay(data) {
  const legendGrid = document.getElementById('legend-grid');
  if (!legendGrid) return;
  legendGrid.innerHTML = '';

  Object.keys(data.days).forEach((dateKey) => {
    const day = data.days[dateKey];
    const dayGroup = document.createElement('div');
    dayGroup.className = 'day-group' + (day.hasOptions ? ' has-options' : '');
    dayGroup.dataset.day = dateKey;

    dayGroup.innerHTML = `<div class="day-group-header"><div class="day-group-color" style="background:${day.color}"></div><span class="day-group-label">${day.label}</span>${day.hasOptions ? '<span class="day-group-badge">Opciones</span>' : ''}</div>`;

    const activitiesList = document.createElement('div');
    activitiesList.className = 'day-activities';

    day.activities.forEach((activity, idx) => {
      const isOptional = !!activity.optional;
      const item = document.createElement('div');
      item.className = 'legend-item' + (isOptional ? ' is-optional' : '');
      const noteText = activity.notes ? (activity.notes.length > 50 ? activity.notes.substring(0, 50) + '...' : activity.notes) : '';
      const markerLabel = isOptional ? activity.optional : (idx + 1);
      const markerColor = isOptional ? '#af52de' : day.color;
      const mapsUrl = getMapsUrl(activity.name);
      const directionsUrl = activity.coords ? `https://www.google.com/maps/dir/?api=1&destination=${activity.coords[0]},${activity.coords[1]}&travelmode=transit` : null;
      let actionsHtml = '';
      if (!activity.isGeneric && mapsUrl) {
        actionsHtml = `<div class="legend-actions"><a href="${mapsUrl}" target="_blank" rel="noopener" class="legend-action-btn" title="Ver en Google Maps"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></a>${directionsUrl ? `<a href="${directionsUrl}" target="_blank" rel="noopener" class="legend-action-btn directions" title="Cómo llegar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg></a>` : ''}</div>`;
      }
      item.innerHTML = `<div class="legend-marker" style="background:${markerColor}">${markerLabel}</div><div class="legend-content"><strong>${activity.name}</strong>${noteText ? '<small>' + noteText + '</small>' : ''}</div>${actionsHtml}`;
      activitiesList.appendChild(item);
    });

    dayGroup.appendChild(activitiesList);
    legendGrid.appendChild(dayGroup);
  });

  // Update hotel info
  const hotelInfo = document.getElementById('hotel-info');
  if (hotelInfo && data.hotel) {
    const hotelMapsUrl = getMapsUrl(data.hotel.name);
    const hotelDirectionsUrl = data.hotel.coords ? `https://www.google.com/maps/dir/?api=1&destination=${data.hotel.coords[0]},${data.hotel.coords[1]}&travelmode=transit` : null;
    let actionsHtml = '';
    if (hotelMapsUrl) actionsHtml = `<div class="legend-actions"><a href="${hotelMapsUrl}" target="_blank" rel="noopener" class="legend-action-btn" title="Ver en Google Maps"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></a>${hotelDirectionsUrl ? `<a href="${hotelDirectionsUrl}" target="_blank" rel="noopener" class="legend-action-btn directions" title="Cómo llegar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg></a>` : ''}</div>`;
    hotelInfo.innerHTML = `<div class="marker">H</div><span>${data.hotel.name}</span>${actionsHtml}`;
  }
}

export function initOverviewMap() {
  const theme = document.documentElement.getAttribute('data-theme');
  const tileUrl = theme === 'dark' ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  const map = L.map('map', { zoomControl: true, attributionControl: false }).setView([35.5, 137.0], 6);
  currentTileLayer = L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);
  currentMap = map;
  window.currentMap = map;
  window.currentTileLayer = currentTileLayer;

  const cities = [
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
    L.marker(city.coords, { icon: L.divIcon({ className: 'custom-marker', html: `<div class="numbered-marker" style="background:${city.color}; width:32px; height:32px; font-size:13px;">${idx + 1}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] }) })
    .bindPopup(`<h4>${city.name}</h4><p>${city.dates}</p><p><a href="${city.link}" style="color:var(--accent);">Ver itinerario</a></p>`)
    .addTo(map);
  });

  L.polyline(cities.map(c => c.coords), { color: theme === 'dark' ? '#0a84ff' : '#0071e3', weight: 2, opacity: 0.5, dashArray: '8, 8' }).addTo(map);
}

export function updateMapTheme() {
  if (!window.currentMap || !window.currentTileLayer) return;
  const theme = document.documentElement.getAttribute('data-theme');
  const tileUrl = theme === 'dark' ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  window.currentMap.removeLayer(window.currentTileLayer);
  window.currentTileLayer = L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(window.currentMap);
}
