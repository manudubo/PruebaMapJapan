import { ITINERARY } from '../data/itinerary.js';
import { getMapsUrl } from '../data/maps.js';

let currentMap = null, currentTileLayer = null;

export function centerNavOnActive() {
  const nav = document.querySelector('.top-nav');
  const active = nav?.querySelector('.is-active');
  if (!nav || !active) return;
  const scrollLeft = active.offsetLeft - (nav.clientWidth / 2) + (active.clientWidth / 2);
  nav.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' });
}

export function moveHotelInfo() {
  const legend = document.querySelector('.legend');
  const info = document.getElementById('hotel-info');
  if (legend && info) legend.insertBefore(info, legend.firstChild);
}

export function initCityMap(city) {
  const data = ITINERARY[city];
  if (!data) return;

  const theme = document.documentElement.getAttribute('data-theme');
  const tileUrl = theme === 'dark' 
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' 
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  const map = L.map('map', { zoomControl: true, attributionControl: false }).setView(data.center, data.zoom);
  currentTileLayer = L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);
  currentMap = window.currentMap = map;
  window.currentTileLayer = currentTileLayer;

  const daySelector = document.getElementById('day-selector');
  const markersByDay = {};
  const allMarkers = [];

  // Hotel Marker
  if (data.hotel?.coords) {
    const url = getMapsUrl(data.hotel.name);
    const popup = `<h4>${data.hotel.name}</h4><p>Alojamiento</p>` + (url ? `<div class="popup-links"><a href="${url}" target="_blank" class="popup-link">Ver en Maps</a></div>` : '');
    L.marker(data.hotel.coords, { 
      icon: L.divIcon({ className: 'custom-marker', html: '<div class="hotel-marker">H</div>', iconSize: [32, 32], iconAnchor: [16, 16] }) 
    }).bindPopup(popup).addTo(map);
  }

  // Activities
  if (daySelector) {
    Object.entries(data.days).forEach(([dateKey, day]) => {
      const btn = document.createElement('button');
      btn.className = `day-btn ${day.hasOptions ? 'has-options' : ''}`;
      btn.textContent = day.label;
      btn.dataset.day = dateKey;
      daySelector.appendChild(btn);

      markersByDay[dateKey] = [];

      day.activities.forEach((act, idx) => {
        if (!act.coords) return;
        const isOpt = !!act.optional;
        const label = isOpt ? act.optional : (idx + 1);
        const color = isOpt ? '#af52de' : day.color;
        
        const marker = L.marker(act.coords, {
          icon: L.divIcon({
            className: 'custom-marker',
            html: `<div class="numbered-marker ${isOpt?'optional':''}" style="background:${color}">${label}</div>`,
            iconSize: [28, 28], iconAnchor: [14, 14]
          })
        });

        const url = getMapsUrl(act.name);
        let popup = `<div class="day-label">${day.label}${isOpt ? ` <span class="optional-badge">${act.optional}</span>` : ''}</div><h4>${act.name}</h4>${act.notes ? `<p>${act.notes}</p>` : ''}`;
        if (url && !act.isGeneric) popup += `<div class="popup-links"><a href="${url}" target="_blank" class="popup-link">Maps</a></div>`;
        
        marker.bindPopup(popup);
        markersByDay[dateKey].push(marker);
        allMarkers.push(marker);
        marker.addTo(map);
      });
    });

    // Filter Logic
    let activeDay = null;
    daySelector.addEventListener('click', (e) => {
      if (!e.target.classList.contains('day-btn')) return;
      const day = e.target.dataset.day;
      
      // Toggle off
      if (activeDay === day) {
        activeDay = null;
        document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
        allMarkers.forEach(m => m.addTo(map));
        document.querySelectorAll('.day-group').forEach(g => g.style.display = 'block');
        map.setView(data.center, data.zoom);
        return;
      }

      // Toggle on
      activeDay = day;
      document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      
      allMarkers.forEach(m => map.removeLayer(m));
      markersByDay[day].forEach(m => m.addTo(map));
      
      document.querySelectorAll('.day-group').forEach(g => g.style.display = g.dataset.day === day ? 'block' : 'none');
      if (markersByDay[day].length) map.fitBounds(L.featureGroup(markersByDay[day]).getBounds().pad(0.2));
    });
  }

  const hotelBtn = document.getElementById('hotel-btn');
  if (hotelBtn && data.hotel?.coords) hotelBtn.addEventListener('click', () => map.setView(data.hotel.coords, 15));

  generateLegend(data);
  moveHotelInfo();
}

function generateLegend(data) {
  const container = document.getElementById('legend-grid');
  if (!container) return;
  container.innerHTML = '';

  Object.entries(data.days).forEach(([key, day]) => {
    const group = document.createElement('div');
    group.className = `day-group ${day.hasOptions ? 'has-options' : ''}`;
    group.dataset.day = key;
    
    let items = '';
    day.activities.forEach((act, idx) => {
      const isOpt = !!act.optional;
      const color = isOpt ? '#af52de' : day.color;
      const label = isOpt ? act.optional : (idx + 1);
      const url = getMapsUrl(act.name);
      
      items += `
        <div class="legend-item ${isOpt ? 'is-optional' : ''}">
          <div class="legend-marker" style="background:${color}">${label}</div>
          <div class="legend-content">
            <strong>${act.name}</strong>
            ${act.notes ? `<small>${act.notes}</small>` : ''}
          </div>
          ${url && !act.isGeneric ? `<div class="legend-actions"><a href="${url}" target="_blank" class="legend-action-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></a></div>` : ''}
        </div>`;
    });

    group.innerHTML = `
      <div class="day-group-header">
        <div class="day-group-color" style="background:${day.color}"></div>
        <span class="day-group-label">${day.label}</span>
        ${day.hasOptions ? '<span class="day-group-badge">Opciones</span>' : ''}
      </div>
      <div class="day-activities">${items}</div>
    `;
    container.appendChild(group);
  });
  
  // Hotel update
  const hotelInfo = document.getElementById('hotel-info');
  if (hotelInfo && data.hotel) {
    const url = getMapsUrl(data.hotel.name);
    hotelInfo.innerHTML = `<div class="marker">H</div><span>${data.hotel.name}</span>` + 
      (url ? `<div class="legend-actions"><a href="${url}" target="_blank" class="legend-action-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></a></div>` : '');
  }
}

export function initOverviewMap() {
  const theme = document.documentElement.getAttribute('data-theme');
  const tileUrl = theme === 'dark' 
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' 
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  const map = L.map('map', { zoomControl: true, attributionControl: false }).setView([35.5, 137.0], 6);
  L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);
  window.currentMap = map;
  window.currentTileLayer = map._layers[Object.keys(map._layers)[0]]; // Quick ref

  const cities = [
    { name: 'Tokyo', coords: [35.6762, 139.7050], color: '#ff3b30', link: 'tokyo.html' },
    { name: 'Nagoya', coords: [35.1815, 136.9066], color: '#ff9500', link: 'nagoya.html' },
    { name: 'Takayama', coords: [36.1400, 137.2500], color: '#ffcc00', link: 'takayama.html' },
    { name: 'Kyoto', coords: [35.0116, 135.7681], color: '#34c759', link: 'kyoto.html' },
    { name: 'Osaka', coords: [34.6937, 135.5023], color: '#5ac8fa', link: 'osaka.html' },
    { name: 'Naoshima', coords: [34.4600, 133.9950], color: '#007aff', link: 'naoshima.html' },
    { name: 'Hakone', coords: [35.2330, 139.1070], color: '#af52de', link: 'hakone.html' },
    { name: 'Tokyo', coords: [35.6862, 139.7150], color: '#ff2d55', link: 'tokyo2.html' }
  ];

  cities.forEach((city, idx) => {
    L.marker(city.coords, {
      icon: L.divIcon({ className: 'custom-marker', html: `<div class="numbered-marker" style="background:${city.color}">${idx+1}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] })
    })
    .bindPopup(`<h4>${city.name}</h4><a href="${city.link}" style="color:var(--accent)">Ver itinerario</a>`)
    .addTo(map);
  });

  L.polyline(cities.map(c => c.coords), { color: theme === 'dark'?'#0a84ff':'#0071e3', weight: 2, opacity: 0.5, dashArray: '8,8' }).addTo(map);
}

export function updateMapTheme() {
  if (!window.currentMap || !window.currentTileLayer) return;
  const theme = document.documentElement.getAttribute('data-theme');
  const url = theme === 'dark' ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  window.currentTileLayer.setUrl(url);
}