// Japan Itinerary - Feb/Mar 2025
// Updated from latest Excel

const ITINERARY = {
  tokyo: {
    center: [35.6762, 139.7050],
    zoom: 12,
    hotel: { name: "Hotel Tokyo (por definir)", coords: [35.6852, 139.7528] },
    dates: "22 Feb – 1 Mar 2025",
    days: {
      "2025-02-22": {
        label: "Sáb 22",
        color: "#dc2626",
        activities: [
          { name: "Palacio Imperial (Kōkyo)", coords: [35.6852, 139.7528], notes: null }
        ]
      },
      "2025-02-23": {
        label: "Dom 23",
        color: "#ea580c",
        activities: [
          { name: "Santuario Hie", coords: [35.6747, 139.7396], notes: null },
          { name: "Akasaka Hikawa Shrine", coords: [35.6683, 139.7357], notes: null },
          { name: "National Art Center Tokyo", coords: [35.6653, 139.7263], notes: "Comprar entrada en el lugar" },
          { name: "21_21 Design Sight", coords: [35.6675, 139.7304], notes: "Comprar entrada en el lugar" }
        ]
      },
      "2025-02-24": {
        label: "Lun 24",
        color: "#ca8a04",
        activities: [
          { name: "TeamLab Planets", coords: [35.6491, 139.7876], notes: "Reservado 19:00" },
          { name: "Tsukiji Fish Market", coords: [35.6651, 139.7705], notes: null },
          { name: "Okuno Building", coords: [35.6728, 139.7672], notes: null },
          { name: "Ginza", coords: [35.6716, 139.7640], notes: null },
          { name: "Jardines Hamarikyu", coords: [35.6596, 139.7636], notes: null }
        ]
      },
      "2025-02-25": {
        label: "Mar 25",
        color: "#16a34a",
        activities: [
          { name: "Ebisu", coords: [35.6464, 139.7134], notes: null },
          { name: "Institute for Nature Study", coords: [35.6360, 139.7213], notes: "Comprar entrada en el lugar" },
          { name: "Nakameguro", coords: [35.6443, 139.6992], notes: null },
          { name: "Daikanyamacho", coords: [35.6488, 139.7032], notes: null }
        ]
      },
      "2025-02-26": {
        label: "Mié 26",
        color: "#0891b2",
        activities: [
          { name: "Shibuya", coords: [35.6595, 139.7005], notes: null },
          { name: "Walking Tour Shibuya", coords: [35.6595, 139.7005], notes: "10:00-12:00 · Punto de encuentro: Estatua Hachiko (lado derecho, cerca de Shibuya Crossing). Salida A8 del metro" },
          { name: "Santuario Meiji", coords: [35.6762, 139.6993], notes: null },
          { name: "Yoyogi Park", coords: [35.6713, 139.6948], notes: null },
          { name: "Harajuku", coords: [35.6713, 139.7048], notes: null },
          { name: "R32 Ichioku Tours", coords: [35.6595, 139.7037], notes: "Reserva 10:45 · Llegar 15 min antes" }
        ]
      },
      "2025-02-27": {
        label: "Jue 27",
        color: "#2563eb",
        activities: [
          { name: "Shinjuku", coords: [35.6896, 139.6918], notes: null },
          { name: "Hanazono Shrine", coords: [35.6932, 139.7067], notes: null },
          { name: "Omoide Yokocho", coords: [35.6930, 139.6995], notes: null },
          { name: "Golden-Gai", coords: [35.6940, 139.7047], notes: null },
          { name: "Shinjuku Gyoen", coords: [35.6853, 139.7094], notes: null },
          { name: "Walking Tour Shinjuku", coords: [35.6896, 139.6917], notes: "Reserva 17:45 · Estación Tochomae, salida A4" }
        ]
      },
      "2025-02-28": {
        label: "Vie 28",
        color: "#7c3aed",
        activities: [
          { name: "Jinbocho", coords: [35.6955, 139.7581], notes: null },
          { name: "Kagurazaka", coords: [35.7022, 139.7414], notes: null },
          { name: "Hakusan", coords: [35.7212, 139.7525], notes: null },
          { name: "Jardín Botánico Koishikawa", coords: [35.7167, 139.7500], notes: "Comprar en el lugar · No abre los lunes" }
        ]
      },
      "2025-03-01": {
        label: "Sáb 1",
        color: "#db2777",
        activities: [
          { name: "Tokyo City Flea Market", coords: [35.6282, 139.7745], notes: null },
          { name: "Shimokitazawa", coords: [35.6617, 139.6683], notes: null }
        ]
      }
    }
  },
  nagoya: {
    center: [35.1804, 137.0858],
    zoom: 11,
    hotel: { name: "Hotel Nagoya (por definir)", coords: [35.1706, 136.8816] },
    dates: "2–3 Mar 2025",
    days: {
      "2025-03-02": {
        label: "Dom 2",
        color: "#16a34a",
        activities: [
          { name: "Ghibli Park", coords: [35.1804, 137.0858], notes: "Reservado 11:00 · Tren desde Tokyo 07:00" }
        ]
      },
      "2025-03-03": {
        label: "Lun 3",
        color: "#2563eb",
        activities: [
          { name: "Explorar Nagoya", coords: [35.1706, 136.8816], notes: "Día libre" }
        ]
      }
    }
  },
  takayama: {
    center: [36.1400, 137.2500],
    zoom: 10,
    hotel: { name: "Amanek Takayama Hotel", coords: [36.1390, 137.2527] },
    dates: "4–7 Mar 2025",
    days: {
      "2025-03-04": {
        label: "Mar 4",
        color: "#dc2626",
        activities: [
          { name: "Check-in Amanek Takayama", coords: [36.1390, 137.2527], notes: "Comprar pasajes para daytrips" },
          { name: "Hida no Sato Folk Village", coords: [36.1578, 137.2175], notes: "Museo al aire libre" }
        ]
      },
      "2025-03-05": {
        label: "Mié 5",
        color: "#16a34a",
        activities: [
          { name: "Shirakawa-go", coords: [36.2569, 136.9067], notes: "Bus info: nouhibus.co.jp" }
        ]
      },
      "2025-03-06": {
        label: "Jue 6",
        color: "#2563eb",
        activities: [
          { name: "Mont Deus Ski Park", coords: [36.0864, 137.3181], notes: "Opcional según nieve · 14km de Takayama" },
          { name: "Hirayu Onsen Ski Area", coords: [36.2261, 137.6000], notes: "Opcional · Pocas pistas, poca dificultad" },
          { name: "Hounokidaira Ski Area", coords: [36.2300, 137.5800], notes: "Opcional · ~75 USD con equipo" }
        ]
      },
      "2025-03-07": {
        label: "Vie 7",
        color: "#7c3aed",
        activities: [
          { name: "Hounokidaira Ski (día 2)", coords: [36.2300, 137.5800], notes: "Opcional 1 · ~75 USD con equipo" },
          { name: "Shinhotaka Ropeway", coords: [36.2925, 137.5943], notes: "Opcional 2 · Bus: nouhibus.co.jp" },
          { name: "Gokayama", coords: [36.4150, 136.8978], notes: "Opcional 3 · Alternativa a Shirakawa-go" }
        ]
      }
    }
  },
  kyoto: {
    center: [35.0000, 135.7600],
    zoom: 12,
    hotel: { name: "Amanek Kyoto Kawaramachi Gojo", coords: [34.9968, 135.7665] },
    dates: "8–13 Mar 2025",
    days: {
      "2025-03-08": {
        label: "Sáb 8",
        color: "#dc2626",
        activities: [
          { name: "Check-in Hotel Amanek", coords: [34.9968, 135.7665], notes: null },
          { name: "Gion", coords: [35.0036, 135.7755], notes: null },
          { name: "Hanamikoji-dori", coords: [35.0030, 135.7755], notes: "Calle tradicional de geishas" }
        ]
      },
      "2025-03-09": {
        label: "Dom 9",
        color: "#ea580c",
        activities: [
          { name: "Parque Maruyama", coords: [35.0028, 135.7822], notes: null },
          { name: "Santuario Yasaka", coords: [35.0036, 135.7785], notes: null },
          { name: "Puente Shijo", coords: [35.0038, 135.7695], notes: null },
          { name: "Pontocho Alley", coords: [35.0067, 135.7712], notes: null },
          { name: "Mercado Nishiki", coords: [35.0049, 135.7642], notes: null }
        ]
      },
      "2025-03-10": {
        label: "Lun 10",
        color: "#ca8a04",
        activities: [
          { name: "Día libre", coords: [35.0000, 135.7600], notes: "A definir" }
        ]
      },
      "2025-03-11": {
        label: "Mar 11",
        color: "#16a34a",
        activities: [
          { name: "Uji", coords: [34.8907, 135.8080], notes: null },
          { name: "Nintendo Museum", coords: [34.9378, 135.7583], notes: "Reservado 14:00–14:30" },
          { name: "Fushimi Inari Taisha", coords: [34.9671, 135.7727], notes: "Recomendado a la noche" },
          { name: "Templo Komyo-in", coords: [34.9691, 135.7733], notes: "Lindo al atardecer" },
          { name: "Río Kamo", coords: [35.0000, 135.7700], notes: null }
        ]
      },
      "2025-03-12": {
        label: "Mié 12",
        color: "#0891b2",
        activities: [
          { name: "Kiyomizu-dera", coords: [34.9949, 135.7850], notes: null },
          { name: "Ishibe Alley", coords: [34.9978, 135.7807], notes: null },
          { name: "Ninenzaka & Sanneizaka", coords: [34.9966, 135.7801], notes: "Muy concurrido" },
          { name: "Yasaka Koshindo", coords: [34.9965, 135.7785], notes: null },
          { name: "Kawai Kanjiro's House", coords: [34.9932, 135.7791], notes: null }
        ]
      },
      "2025-03-13": {
        label: "Jue 13",
        color: "#7c3aed",
        activities: [
          { name: "Arashiyama Bamboo Forest", coords: [35.0171, 135.6716], notes: null },
          { name: "Okochi Sanso Garden", coords: [35.0185, 135.6700], notes: null },
          { name: "Arashiyama Park Kameyama", coords: [35.0152, 135.6763], notes: null },
          { name: "Templo Tenryu-ji", coords: [35.0154, 135.6748], notes: null },
          { name: "Monkey Park Iwatayama", coords: [35.0110, 135.6780], notes: null },
          { name: "Arashiyama East Park", coords: [35.0133, 135.6800], notes: null }
        ]
      }
    }
  },
  osaka: {
    center: [34.6900, 135.5000],
    zoom: 12,
    hotel: { name: "Shizutetsu Hotel Prezio Shinsaibashi", coords: [34.6789, 135.4983] },
    dates: "14–17 Mar 2025",
    days: {
      "2025-03-14": {
        label: "Vie 14",
        color: "#dc2626",
        activities: [
          { name: "Check-in Hotel Shizutetsu", coords: [34.6789, 135.4983], notes: null },
          { name: "Dotonbori", coords: [34.6685, 135.5015], notes: null },
          { name: "Hozen-ji Temple", coords: [34.6688, 135.5037], notes: null },
          { name: "Kuromon Market", coords: [34.6639, 135.5068], notes: null },
          { name: "Namba Yasaka Shrine", coords: [34.6621, 135.4975], notes: null }
        ]
      },
      "2025-03-15": {
        label: "Sáb 15",
        color: "#16a34a",
        activities: [
          { name: "Osaka Castle Walking Tour", coords: [34.6850, 135.5240], notes: "09:00 · Lawson S Otemae Rest House · Letrero Local Guide Stars" },
          { name: "Tenma & Tenmabashi", coords: [34.7025, 135.5130], notes: null },
          { name: "Osaka Tenmangu", coords: [34.7025, 135.5150], notes: null },
          { name: "Nakazaki", coords: [34.7075, 135.5033], notes: "Vintage y coffee hopping" }
        ]
      },
      "2025-03-16": {
        label: "Dom 16",
        color: "#2563eb",
        activities: [
          { name: "Universal Studios Japan", coords: [34.6654, 135.4323], notes: "Día completo · Super Nintendo World" }
        ]
      },
      "2025-03-17": {
        label: "Lun 17",
        color: "#7c3aed",
        activities: [
          { name: "Templo Katsuo-ji", coords: [34.8781, 135.4869], notes: "Opcional · Ir temprano, taxi hasta Dainichi Parking" },
          { name: "Minoh Falls", coords: [34.8530, 135.4730], notes: "Opcional · Caminar al sur hasta Mino-o Station" }
        ]
      }
    }
  }
};

// Theme Management
function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeButton(theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeButton(next);
}

function updateThemeButton(theme) {
  const btn = document.querySelector('.theme-toggle');
  if (!btn) return;
  
  const icon = theme === 'dark' 
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
  
  btn.innerHTML = icon + '<span>' + (theme === 'dark' ? 'Light' : 'Dark') + '</span>';
}

// Map initialization
function initCityMap(city) {
  const data = ITINERARY[city];
  if (!data) return;

  // Determine tile layer based on theme
  const theme = document.documentElement.getAttribute('data-theme');
  const tileUrl = theme === 'dark' 
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  const map = L.map('map', {
    zoomControl: true,
    attributionControl: false
  }).setView(data.center, data.zoom);

  const tileLayer = L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);

  // Store for theme switching
  window.currentMap = map;
  window.currentTileLayer = tileLayer;

  const markersByDay = {};
  const allMarkers = [];

  // Create day selector
  const daySelector = document.getElementById('day-selector');
  if (daySelector) {
    const days = Object.keys(data.days);
    
    days.forEach((dateKey) => {
      const day = data.days[dateKey];
      const btn = document.createElement('button');
      btn.className = 'day-btn';
      btn.textContent = day.label;
      btn.dataset.day = dateKey;
      daySelector.appendChild(btn);

      markersByDay[dateKey] = [];

      day.activities.forEach((activity, idx) => {
        if (!activity.coords) return;

        const marker = L.marker(activity.coords, {
          icon: L.divIcon({
            className: 'custom-marker',
            html: `<div class="numbered-marker" style="background:${day.color}">${idx + 1}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          })
        });

        let popup = `<div class="day-label">${day.label}</div>`;
        popup += `<h4>${activity.name}</h4>`;
        if (activity.notes) {
          popup += `<p>${activity.notes}</p>`;
        }

        marker.bindPopup(popup);
        markersByDay[dateKey].push(marker);
        allMarkers.push(marker);
      });
    });
  }

  // Add hotel marker
  if (data.hotel && data.hotel.coords) {
    const hotelMarker = L.marker(data.hotel.coords, {
      icon: L.divIcon({
        className: 'custom-marker',
        html: `<div class="hotel-marker">H</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      })
    }).bindPopup(`<h4>${data.hotel.name}</h4><p>Alojamiento</p>`);
    hotelMarker.addTo(map);
  }

  // Show all markers
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
        return;
      }

      activeDay = selectedDay;
      document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');

      allMarkers.forEach(m => map.removeLayer(m));
      markersByDay[selectedDay].forEach(m => m.addTo(map));

      if (markersByDay[selectedDay].length > 0) {
        const group = L.featureGroup(markersByDay[selectedDay]);
        map.fitBounds(group.getBounds().pad(0.3));
      }
    });
  }

  // Generate legend
  generateLegend(data);

  return map;
}

function generateLegend(data) {
  const legendGrid = document.getElementById('legend-grid');
  if (!legendGrid) return;

  legendGrid.innerHTML = '';

  Object.keys(data.days).forEach((dateKey) => {
    const day = data.days[dateKey];
    
    day.activities.forEach((activity, idx) => {
      const item = document.createElement('div');
      item.className = 'legend-item';
      
      let noteText = '';
      if (activity.notes) {
        noteText = activity.notes.length > 60 
          ? activity.notes.substring(0, 60) + '...' 
          : activity.notes;
      }

      item.innerHTML = `
        <div class="legend-marker" style="background:${day.color}">${idx + 1}</div>
        <div class="legend-content">
          <strong>${activity.name}</strong>
          <small>${day.label}${noteText ? ' · ' + noteText : ''}</small>
        </div>
      `;
      legendGrid.appendChild(item);
    });
  });

  // Hotel info
  const hotelInfo = document.getElementById('hotel-info');
  if (hotelInfo && data.hotel) {
    hotelInfo.innerHTML = `
      <div class="marker">H</div>
      <span>${data.hotel.name}</span>
    `;
  }
}

// Overview map
function initOverviewMap() {
  const theme = document.documentElement.getAttribute('data-theme');
  const tileUrl = theme === 'dark'
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  const map = L.map('map', {
    zoomControl: true,
    attributionControl: false
  }).setView([36.0, 137.5], 6);

  const tileLayer = L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);

  window.currentMap = map;
  window.currentTileLayer = tileLayer;

  const cities = [
    { name: 'Tokyo', coords: [35.6762, 139.7050], dates: '22 Feb – 1 Mar', color: '#dc2626', link: 'tokyo.html' },
    { name: 'Nagoya', coords: [35.1815, 136.9066], dates: '2–3 Mar', color: '#ea580c', link: 'nagoya.html' },
    { name: 'Takayama', coords: [36.1400, 137.2500], dates: '4–7 Mar', color: '#16a34a', link: 'takayama.html' },
    { name: 'Kyoto', coords: [35.0116, 135.7681], dates: '8–13 Mar', color: '#2563eb', link: 'kyoto.html' },
    { name: 'Osaka', coords: [34.6937, 135.5023], dates: '14–17 Mar', color: '#7c3aed', link: 'osaka.html' }
  ];

  cities.forEach((city, idx) => {
    L.marker(city.coords, {
      icon: L.divIcon({
        className: 'custom-marker',
        html: `<div class="numbered-marker" style="background:${city.color}; width:36px; height:36px; font-size:14px;">${idx + 1}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      })
    })
    .bindPopup(`<h4>${city.name}</h4><p>${city.dates}</p><p><a href="${city.link}" style="color:var(--accent);">Ver itinerario</a></p>`)
    .addTo(map);
  });

  // Route line
  const routeCoords = cities.map(c => c.coords);
  L.polyline(routeCoords, { 
    color: theme === 'dark' ? '#3b9eff' : '#0066cc', 
    weight: 2, 
    opacity: 0.5, 
    dashArray: '8, 8' 
  }).addTo(map);
}

// Update map tiles on theme change
function updateMapTheme() {
  if (!window.currentMap || !window.currentTileLayer) return;
  
  const theme = document.documentElement.getAttribute('data-theme');
  const tileUrl = theme === 'dark'
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  window.currentMap.removeLayer(window.currentTileLayer);
  window.currentTileLayer = L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(window.currentMap);
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  initTheme();

  const themeBtn = document.querySelector('.theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      toggleTheme();
      updateMapTheme();
    });
  }

  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  const page = mapEl.dataset.city;
  if (page === 'overview') {
    initOverviewMap();
  } else if (page && ITINERARY[page]) {
    initCityMap(page);
  }
});
