// Japan Itinerary - Feb/Mar 2026
// Updated from latest Excel with all cities and features

const ITINERARY = {
  tokyo: {
    center: [35.6762, 139.7050],
    zoom: 12,
    hotel: { name: "Via Inn Prime Akasaka", coords: [35.6747, 139.7371] },
    dates: "22 Feb – 1 Mar 2026",
    days: {
      "2026-02-22": {
        label: "Dom 22",
        color: "#ff3b30",
        activities: [
          { name: "Check-in Via Inn Prime Akasaka", coords: [35.6747, 139.7371], notes: null },
          { name: "Palacio Imperial (Kōkyo)", coords: [35.6852, 139.7528], notes: null }
        ]
      },
      "2026-02-23": {
        label: "Lun 23",
        color: "#ff9500",
        activities: [
          { name: "Santuario Hie", coords: [35.6747, 139.7396], notes: null },
          { name: "Akasaka Hikawa Shrine", coords: [35.6683, 139.7357], notes: null },
          { name: "National Art Center Tokyo", coords: [35.6653, 139.7263], notes: "Comprar entrada en el lugar" },
          { name: "21_21 Design Sight", coords: [35.6675, 139.7304], notes: "Comprar entrada en el lugar" }
        ]
      },
      "2026-02-24": {
        label: "Mar 24",
        color: "#ffcc00",
        activities: [
          { name: "TeamLab Planets", coords: [35.6491, 139.7876], notes: "Reservado 19:00" },
          { name: "Tsukiji Fish Market", coords: [35.6651, 139.7705], notes: null },
          { name: "Okuno Building", coords: [35.6728, 139.7672], notes: null },
          { name: "Ginza", coords: [35.6716, 139.7640], notes: null },
          { name: "Jardines Hamarikyu", coords: [35.6596, 139.7636], notes: null }
        ]
      },
      "2026-02-25": {
        label: "Mié 25",
        color: "#34c759",
        activities: [
          { name: "Ebisu", coords: [35.6464, 139.7134], notes: null },
          { name: "Institute for Nature Study", coords: [35.6360, 139.7213], notes: "Comprar entrada en el lugar" },
          { name: "Nakameguro", coords: [35.6443, 139.6992], notes: null },
          { name: "Daikanyamacho", coords: [35.6488, 139.7032], notes: null }
        ]
      },
      "2026-02-26": {
        label: "Jue 26",
        color: "#5ac8fa",
        activities: [
          { name: "Shibuya", coords: [35.6595, 139.7005], notes: null },
          { name: "Walking Tour Shibuya", coords: [35.6595, 139.7005], notes: "10:00-12:00 · Estatua Hachiko, salida A8" },
          { name: "Santuario Meiji", coords: [35.6762, 139.6993], notes: null },
          { name: "Yoyogi Park", coords: [35.6713, 139.6948], notes: null },
          { name: "Harajuku", coords: [35.6713, 139.7048], notes: null },
          { name: "R32 Ichioku Tours", coords: [35.6595, 139.7037], notes: "Reserva 10:45" }
        ]
      },
      "2026-02-27": {
        label: "Vie 27",
        color: "#007aff",
        activities: [
          { name: "Shinjuku", coords: [35.6896, 139.6918], notes: null },
          { name: "Hanazono Shrine", coords: [35.6932, 139.7067], notes: null },
          { name: "Omoide Yokocho", coords: [35.6930, 139.6995], notes: null },
          { name: "Golden-Gai", coords: [35.6940, 139.7047], notes: null },
          { name: "Shinjuku Gyoen", coords: [35.6853, 139.7094], notes: null },
          { name: "Walking Tour Shinjuku", coords: [35.6896, 139.6917], notes: "Reserva 17:45 · Tochomae, salida A4" }
        ]
      },
      "2026-02-28": {
        label: "Sáb 28",
        color: "#af52de",
        activities: [
          { name: "Jinbocho", coords: [35.6955, 139.7581], notes: null },
          { name: "Kagurazaka", coords: [35.7022, 139.7414], notes: null },
          { name: "Hakusan", coords: [35.7212, 139.7525], notes: null },
          { name: "Jardín Botánico Koishikawa", coords: [35.7167, 139.7500], notes: "Comprar en el lugar · No abre lunes" }
        ]
      },
      "2026-03-01": {
        label: "Dom 1",
        color: "#ff2d55",
        activities: [
          { name: "Tokyo City Flea Market", coords: [35.6282, 139.7745], notes: null },
          { name: "Shimokitazawa", coords: [35.6617, 139.6683], notes: null }
        ]
      }
    }
  },
  nagoya: {
    center: [35.1700, 136.9000],
    zoom: 11,
    hotel: { name: "Hotel Trusty Nagoya Shirakawa", coords: [35.1658, 136.8987] },
    dates: "2–3 Mar 2026",
    days: {
      "2026-03-02": {
        label: "Lun 2",
        color: "#34c759",
        activities: [
          { name: "Check-in Hotel Trusty", coords: [35.1658, 136.8987], notes: "Tren desde Tokyo 07:00" },
          { name: "Ghibli Park", coords: [35.1804, 137.0858], notes: "Reservado 11:00" }
        ]
      },
      "2026-03-03": {
        label: "Mar 3",
        color: "#007aff",
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
    dates: "4–7 Mar 2026",
    days: {
      "2026-03-04": {
        label: "Mié 4",
        color: "#ff3b30",
        activities: [
          { name: "Check-in Amanek Takayama", coords: [36.1390, 137.2527], notes: "Comprar pasajes para daytrips" },
          { name: "Hida no Sato Folk Village", coords: [36.1578, 137.2175], notes: "Museo al aire libre" }
        ]
      },
      "2026-03-05": {
        label: "Jue 5",
        color: "#34c759",
        activities: [
          { name: "Shirakawa-go", coords: [36.2569, 136.9067], notes: "Bus info: nouhibus.co.jp" }
        ]
      },
      "2026-03-06": {
        label: "Vie 6",
        color: "#007aff",
        hasOptions: true,
        activities: [
          { name: "Mont Deus Ski Park", coords: [36.0864, 137.3181], notes: "14km de Takayama", optional: "A" },
          { name: "Hirayu Onsen Ski Area", coords: [36.2261, 137.6000], notes: "Pocas pistas, poca dificultad", optional: "B" },
          { name: "Hounokidaira Ski Area", coords: [36.2300, 137.5800], notes: "~75 USD con equipo", optional: "C" }
        ]
      },
      "2026-03-07": {
        label: "Sáb 7",
        color: "#af52de",
        hasOptions: true,
        activities: [
          { name: "Hounokidaira Ski (día 2)", coords: [36.2300, 137.5800], notes: "~75 USD con equipo", optional: "1" },
          { name: "Shinhotaka Ropeway", coords: [36.2925, 137.5943], notes: "Bus: nouhibus.co.jp", optional: "2" },
          { name: "Gokayama", coords: [36.4150, 136.8978], notes: "Alternativa a Shirakawa-go", optional: "3" }
        ]
      }
    }
  },
  kyoto: {
    center: [35.0000, 135.7600],
    zoom: 12,
    hotel: { name: "Hotel Amanek Kyoto Kawaramachi Gojo", coords: [34.9968, 135.7665] },
    dates: "8–13 Mar 2026",
    days: {
      "2026-03-08": {
        label: "Dom 8",
        color: "#ff3b30",
        activities: [
          { name: "Check-in Amanek Kyoto", coords: [34.9968, 135.7665], notes: null },
          { name: "Gion", coords: [35.0036, 135.7755], notes: null },
          { name: "Hanamikoji-dori", coords: [35.0030, 135.7755], notes: "Calle tradicional de geishas" }
        ]
      },
      "2026-03-09": {
        label: "Lun 9",
        color: "#ff9500",
        activities: [
          { name: "Parque Maruyama", coords: [35.0028, 135.7822], notes: null },
          { name: "Santuario Yasaka", coords: [35.0036, 135.7785], notes: null },
          { name: "Puente Shijo", coords: [35.0038, 135.7695], notes: null },
          { name: "Pontocho Alley", coords: [35.0067, 135.7712], notes: null },
          { name: "Mercado Nishiki", coords: [35.0049, 135.7642], notes: null }
        ]
      },
      "2026-03-10": {
        label: "Mar 10",
        color: "#ffcc00",
        activities: [
          { name: "Día libre", coords: [35.0000, 135.7600], notes: "A definir" }
        ]
      },
      "2026-03-11": {
        label: "Mié 11",
        color: "#34c759",
        activities: [
          { name: "Uji", coords: [34.8907, 135.8080], notes: null },
          { name: "Nintendo Museum", coords: [34.9378, 135.7583], notes: "Reservado 14:00–14:30" },
          { name: "Fushimi Inari Taisha", coords: [34.9671, 135.7727], notes: "Recomendado a la noche" },
          { name: "Templo Komyo-in", coords: [34.9691, 135.7733], notes: "Lindo al atardecer" },
          { name: "Río Kamo", coords: [35.0000, 135.7700], notes: null }
        ]
      },
      "2026-03-12": {
        label: "Jue 12",
        color: "#5ac8fa",
        activities: [
          { name: "Kiyomizu-dera", coords: [34.9949, 135.7850], notes: null },
          { name: "Ishibe Alley", coords: [34.9978, 135.7807], notes: null },
          { name: "Ninenzaka & Sanneizaka", coords: [34.9966, 135.7801], notes: "Muy concurrido" },
          { name: "Yasaka Koshindo", coords: [34.9965, 135.7785], notes: null },
          { name: "Kawai Kanjiro's House", coords: [34.9932, 135.7791], notes: null }
        ]
      },
      "2026-03-13": {
        label: "Vie 13",
        color: "#af52de",
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
    dates: "14–17 Mar 2026",
    days: {
      "2026-03-14": {
        label: "Sáb 14",
        color: "#ff3b30",
        activities: [
          { name: "Check-in Shizutetsu Hotel", coords: [34.6789, 135.4983], notes: null },
          { name: "Dotonbori", coords: [34.6685, 135.5015], notes: null },
          { name: "Hozen-ji Temple", coords: [34.6688, 135.5037], notes: null },
          { name: "Kuromon Market", coords: [34.6639, 135.5068], notes: null },
          { name: "Namba Yasaka Shrine", coords: [34.6621, 135.4975], notes: null }
        ]
      },
      "2026-03-15": {
        label: "Dom 15",
        color: "#34c759",
        activities: [
          { name: "Osaka Castle Walking Tour", coords: [34.6850, 135.5240], notes: "09:00 · Lawson S Otemae Rest House" },
          { name: "Tenma & Tenmabashi", coords: [34.7025, 135.5130], notes: null },
          { name: "Osaka Tenmangu", coords: [34.7025, 135.5150], notes: null },
          { name: "Nakazaki", coords: [34.7075, 135.5033], notes: "Vintage y coffee hopping" }
        ]
      },
      "2026-03-16": {
        label: "Lun 16",
        color: "#007aff",
        activities: [
          { name: "Universal Studios Japan", coords: [34.6654, 135.4323], notes: "Día completo · Reserva confirmada" }
        ]
      },
      "2026-03-17": {
        label: "Mar 17",
        color: "#af52de",
        hasOptions: true,
        activities: [
          { name: "Templo Katsuo-ji + Minoh Falls", coords: [34.8781, 135.4869], notes: "Ir temprano, taxi a Dainichi Parking", optional: "A" },
          { name: "Día libre", coords: [34.6900, 135.5000], notes: "Explorar Osaka a tu ritmo", optional: "B" }
        ]
      }
    }
  },
  naoshima: {
    center: [34.4600, 133.9950],
    zoom: 13,
    hotel: { name: "UNO Hotel", coords: [34.4893, 133.9496] },
    dates: "18–19 Mar 2026",
    days: {
      "2026-03-18": {
        label: "Mié 18",
        color: "#ff3b30",
        activities: [
          { name: "Check-in UNO Hotel", coords: [34.4893, 133.9496], notes: null }
        ]
      },
      "2026-03-19": {
        label: "Jue 19",
        color: "#34c759",
        activities: [
          { name: "Naoshima Island", coords: [34.4600, 133.9950], notes: "Isla del arte" },
          { name: "Museos de Arte", coords: [34.4550, 133.9900], notes: "Chichu Art Museum, Benesse House, etc." }
        ]
      }
    }
  },
  hakone: {
    center: [35.2330, 139.1070],
    zoom: 12,
    hotel: { name: "Asante Inn", coords: [35.2330, 139.1070] },
    dates: "20–21 Mar 2026",
    days: {
      "2026-03-20": {
        label: "Vie 20",
        color: "#ff3b30",
        activities: [
          { name: "Check-in Asante Inn", coords: [35.2330, 139.1070], notes: null }
        ]
      },
      "2026-03-21": {
        label: "Sáb 21",
        color: "#34c759",
        activities: [
          { name: "Recorrer Hakone", coords: [35.2330, 139.1070], notes: "Onsen, vistas del Fuji" }
        ]
      }
    }
  },
  tokyo2: {
    center: [35.6762, 139.7050],
    zoom: 12,
    hotel: { name: "Via Inn Prime Akasaka", coords: [35.6747, 139.7371] },
    dates: "22–23 Mar 2026",
    days: {
      "2026-03-22": {
        label: "Dom 22",
        color: "#ff3b30",
        activities: [
          { name: "Check-in Via Inn Prime Akasaka", coords: [35.6747, 139.7371], notes: "Check-in 15:00" }
        ]
      },
      "2026-03-23": {
        label: "Lun 23",
        color: "#34c759",
        activities: [
          { name: "Última recorrida y compras", coords: [35.6762, 139.7050], notes: "Check-out 10:00 · Dejar bolsos en hotel" }
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

// Countdown Timer
function initCountdown() {
  const countdownEl = document.getElementById('countdown');
  if (!countdownEl) return;

  // Target: Sun, 22 Feb 2026 07:55 AM Tokyo time (JST = UTC+9)
  // Convert to UTC: 22 Feb 2026 07:55 JST = 21 Feb 2026 22:55 UTC
  const targetDate = new Date('2026-02-21T22:55:00Z');

  function updateCountdown() {
    const now = new Date();
    const diff = targetDate - now;

    if (diff <= 0) {
      countdownEl.innerHTML = '<div class="countdown-unit"><div class="countdown-value">0</div><div class="countdown-text">Llegaste!</div></div>';
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    countdownEl.innerHTML = `
      <div class="countdown-unit">
        <div class="countdown-value">${days}</div>
        <div class="countdown-text">Días</div>
      </div>
      <div class="countdown-unit">
        <div class="countdown-value">${hours.toString().padStart(2, '0')}</div>
        <div class="countdown-text">Horas</div>
      </div>
      <div class="countdown-unit">
        <div class="countdown-value">${minutes.toString().padStart(2, '0')}</div>
        <div class="countdown-text">Min</div>
      </div>
      <div class="countdown-unit">
        <div class="countdown-value">${seconds.toString().padStart(2, '0')}</div>
        <div class="countdown-text">Seg</div>
      </div>
    `;
  }

  updateCountdown();
  setInterval(updateCountdown, 1000);
}

// Map initialization
let currentHotelCoords = null;

function initCityMap(city) {
  const data = ITINERARY[city];
  if (!data) return;

  const theme = document.documentElement.getAttribute('data-theme');
  const tileUrl = theme === 'dark' 
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  const map = L.map('map', {
    zoomControl: true,
    attributionControl: false
  }).setView(data.center, data.zoom);

  const tileLayer = L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);

  window.currentMap = map;
  window.currentTileLayer = tileLayer;
  currentHotelCoords = data.hotel?.coords;

  const markersByDay = {};
  const allMarkers = [];

  // Create day selector
  const daySelector = document.getElementById('day-selector');
  if (daySelector) {
    const days = Object.keys(data.days);
    
    days.forEach((dateKey) => {
      const day = data.days[dateKey];
      const btn = document.createElement('button');
      btn.className = 'day-btn' + (day.hasOptions ? ' has-options' : '');
      btn.textContent = day.label;
      btn.dataset.day = dateKey;
      if (day.hasOptions) {
        btn.title = 'Este día tiene opciones alternativas';
      }
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
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          })
        });

        let popup = `<div class="day-label">${day.label}${isOptional ? '<span class="optional-badge">Opción ' + activity.optional + '</span>' : ''}</div>`;
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

  // Hotel button
  const hotelBtn = document.getElementById('hotel-btn');
  if (hotelBtn && data.hotel?.coords) {
    hotelBtn.addEventListener('click', () => {
      map.setView(data.hotel.coords, 15);
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
      const isOptional = !!activity.optional;
      const item = document.createElement('div');
      item.className = 'legend-item' + (isOptional ? ' is-optional' : '');
      
      let noteText = '';
      if (activity.notes) {
        noteText = activity.notes.length > 50 
          ? activity.notes.substring(0, 50) + '...' 
          : activity.notes;
      }

      const markerLabel = isOptional ? activity.optional : (idx + 1);
      const markerColor = isOptional ? '#af52de' : day.color;

      item.innerHTML = `
        <div class="legend-marker" style="background:${markerColor}">${markerLabel}</div>
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
  }).setView([35.5, 137.0], 6);

  const tileLayer = L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);

  window.currentMap = map;
  window.currentTileLayer = tileLayer;

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
    L.marker(city.coords, {
      icon: L.divIcon({
        className: 'custom-marker',
        html: `<div class="numbered-marker" style="background:${city.color}; width:32px; height:32px; font-size:13px;">${idx + 1}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      })
    })
    .bindPopup(`<h4>${city.name}</h4><p>${city.dates}</p><p><a href="${city.link}" style="color:var(--accent);">Ver itinerario</a></p>`)
    .addTo(map);
  });

  // Route line
  const routeCoords = cities.map(c => c.coords);
  L.polyline(routeCoords, { 
    color: theme === 'dark' ? '#0a84ff' : '#0071e3', 
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
  initCountdown();

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
