// Japan Itinerary Data - Feb/Mar 2025
const ITINERARY = {
  tokyo: {
    center: [35.6762, 139.7050],
    zoom: 12,
    hotel: { name: "Hotel Tokyo (por definir)", coords: [35.6852, 139.7528] },
    dates: "22 Feb - 1 Mar 2025",
    days: {
      "2025-02-22": {
        label: "Sáb 22 Feb",
        color: "#ef4444",
        activities: [
          { name: "Palacio Imperial (Kōkyo)", coords: [35.6852, 139.7528], notes: null }
        ]
      },
      "2025-02-23": {
        label: "Dom 23 Feb",
        color: "#f97316",
        activities: [
          { name: "Santuario Hie", coords: [35.6747, 139.7396], notes: null },
          { name: "Akasaka Hikawa Shrine", coords: [35.6683, 139.7357], notes: null },
          { name: "Museo Nacional Art Center Tokyo", coords: [35.6653, 139.7263], notes: "COMPRAR ALLA 23 feb" },
          { name: "21_21 Design Sight", coords: [35.6675, 139.7304], notes: "COMPRAR ALLA 23 feb" }
        ]
      },
      "2025-02-24": {
        label: "Lun 24 Feb",
        color: "#eab308",
        activities: [
          { name: "TeamLab Planets", coords: [35.6491, 139.7876], notes: "Comprado para ir el 24 de febrero a las 19" },
          { name: "Tsukiji Fish Market", coords: [35.6651, 139.7705], notes: null },
          { name: "Okuno Building", coords: [35.6728, 139.7672], notes: null },
          { name: "Ginza Barrio", coords: [35.6716, 139.7640], notes: null },
          { name: "Jardines de Hamarikyu", coords: [35.6596, 139.7636], notes: null }
        ]
      },
      "2025-02-25": {
        label: "Mar 25 Feb",
        color: "#22c55e",
        activities: [
          { name: "Ebisu barrio", coords: [35.6464, 139.7134], notes: null },
          { name: "Reserva Natural (Institute for Nature Study)", coords: [35.6360, 139.7213], notes: "COMPRAR ALLA. 25 feb" },
          { name: "Nakameguro barrio", coords: [35.6443, 139.6992], notes: null },
          { name: "Daikanyamacho barrio", coords: [35.6488, 139.7032], notes: null }
        ]
      },
      "2025-02-26": {
        label: "Mié 26 Feb",
        color: "#06b6d4",
        activities: [
          { name: "Shibuya barrio", coords: [35.6595, 139.7005], notes: null },
          { name: "Free Walking Tour Shibuya", coords: [35.6595, 139.7005], notes: "10 a 12 - Reunión junto a estatua HACHIKO, salida A8 metro" },
          { name: "Santuario Meiji", coords: [35.6762, 139.6993], notes: null },
          { name: "Yoyogi Park", coords: [35.6713, 139.6948], notes: null },
          { name: "Harajuku barrio", coords: [35.6713, 139.7048], notes: null },
          { name: "R32 Ichioku Tours", coords: [35.6595, 139.7037], notes: "Reserva 10:45 - Llegar 15 min antes" }
        ]
      },
      "2025-02-27": {
        label: "Jue 27 Feb",
        color: "#8b5cf6",
        activities: [
          { name: "Shinjuku barrio", coords: [35.6896, 139.6918], notes: null },
          { name: "Hanazono Shrine", coords: [35.6932, 139.7067], notes: null },
          { name: "Omoide Yokocho", coords: [35.6930, 139.6995], notes: null },
          { name: "Golden-Gai", coords: [35.6940, 139.7047], notes: null },
          { name: "Shinjuku Gyoen (Parque)", coords: [35.6853, 139.7094], notes: null },
          { name: "Free Walking Tour Shinjuku", coords: [35.6896, 139.6917], notes: "Reserva 17:45 - Estación TOCHOMAE, salida A4" }
        ]
      },
      "2025-02-28": {
        label: "Vie 28 Feb",
        color: "#ec4899",
        activities: [
          { name: "Jinbocho barrio", coords: [35.6955, 139.7581], notes: null },
          { name: "Kagurazaka barrio", coords: [35.7022, 139.7414], notes: null },
          { name: "Hakusan barrio", coords: [35.7212, 139.7525], notes: null },
          { name: "Jardín Botánico Koishikawa", coords: [35.7167, 139.7500], notes: "COMPRAR ALLA - No abre Lunes" }
        ]
      },
      "2025-03-01": {
        label: "Sáb 1 Mar",
        color: "#64748b",
        activities: [
          { name: "Flea Market & Shimokitazawa", coords: [35.6617, 139.6683], notes: "Último día en Tokyo" },
          { name: "TeamLab Borderless (opcional)", coords: [35.6606, 139.7420], notes: "Azabudai Hills - COMPRAR ENTRADA" }
        ]
      }
    }
  },
  nagoya: {
    center: [35.1804, 137.0858],
    zoom: 11,
    hotel: { name: "Hotel Nagoya (por definir)", coords: [35.1706, 136.8816] },
    dates: "2-4 Mar 2025",
    days: {
      "2025-03-02": {
        label: "Dom 2 Mar",
        color: "#22c55e",
        activities: [
          { name: "Ghibli Park", coords: [35.1804, 137.0858], notes: "Reservado 2 de Marzo 11 AM slot - Tren 7am desde Tokyo" }
        ]
      },
      "2025-03-03": {
        label: "Lun 3 Mar",
        color: "#3b82f6",
        activities: [
          { name: "Recorrer Nagoya", coords: [35.1706, 136.8816], notes: "Día libre para explorar" }
        ]
      },
      "2025-03-04": {
        label: "Mar 4 Mar",
        color: "#8b5cf6",
        activities: [
          { name: "Salida a Takayama", coords: [35.1706, 136.8816], notes: "Reservar trenes en westjr.co.jp - Asientos C y D al fondo" }
        ]
      }
    }
  },
  takayama: {
    center: [36.1400, 137.2500],
    zoom: 10,
    hotel: { name: "Amanek Takayama Hotel", coords: [36.1390, 137.2527] },
    dates: "4-7 Mar 2025",
    days: {
      "2025-03-04": {
        label: "Mar 4 Mar",
        color: "#ef4444",
        activities: [
          { name: "Check-in Amanek Takayama", coords: [36.1390, 137.2527], notes: "Comprar pasajes para daytrips" }
        ]
      },
      "2025-03-05": {
        label: "Mié 5 Mar",
        color: "#22c55e",
        activities: [
          { name: "Shirakawa-go", coords: [36.2569, 136.9067], notes: "Bus info: nouhibus.co.jp - Investigar lugares para comer" }
        ]
      },
      "2025-03-06": {
        label: "Jue 6 Mar",
        color: "#3b82f6",
        activities: [
          { name: "Mont Deus Ski Park", coords: [36.0864, 137.3181], notes: "Opcional según nieve - 14km de Takayama" },
          { name: "Hirayu Onsen Ski Area", coords: [36.2261, 137.6000], notes: "Alternativa: Pocas pistas, poca dificultad" },
          { name: "Hounokidaira Ski Area", coords: [36.2261, 137.6000], notes: "~75 USD con equipo y ropa" }
        ]
      },
      "2025-03-07": {
        label: "Vie 7 Mar",
        color: "#8b5cf6",
        activities: [
          { name: "Shinhotaka Ropeway", coords: [36.2925, 137.5943], notes: "Bus info: nouhibus.co.jp" },
          { name: "Hida Furukawa", coords: [36.2350, 137.1867], notes: "Pueblo tradicional cercano" },
          { name: "Gokayama", coords: [36.4150, 136.8978], notes: "Alternativa a Shirakawa-go, menos turístico" }
        ]
      }
    }
  },
  kyoto: {
    center: [35.0000, 135.7600],
    zoom: 12,
    hotel: { name: "Amanek Kyoto Kawaramachi Gojo", coords: [34.9968, 135.7665] },
    dates: "8-13 Mar 2025",
    days: {
      "2025-03-08": {
        label: "Sáb 8 Mar",
        color: "#ef4444",
        activities: [
          { name: "Check-in Hotel Amanek", coords: [34.9968, 135.7665], notes: null },
          { name: "Gion", coords: [35.0036, 135.7755], notes: "Barrio de geishas" },
          { name: "Hanami Lane", coords: [35.0030, 135.7760], notes: "Callejón tradicional en Gion" }
        ]
      },
      "2025-03-09": {
        label: "Dom 9 Mar",
        color: "#f97316",
        activities: [
          { name: "Parque Maruyama", coords: [35.0028, 135.7822], notes: null },
          { name: "Santuario Yasaka", coords: [35.0036, 135.7785], notes: null },
          { name: "Puente Shijo", coords: [35.0038, 135.7695], notes: null },
          { name: "Pontocho Alley", coords: [35.0067, 135.7712], notes: null },
          { name: "Mercado de Nishiki", coords: [35.0049, 135.7642], notes: null }
        ]
      },
      "2025-03-10": {
        label: "Lun 10 Mar",
        color: "#eab308",
        activities: [
          { name: "Día libre / Exploración", coords: [35.0000, 135.7600], notes: "Día para revisitar lugares favoritos o descansar" }
        ]
      },
      "2025-03-11": {
        label: "Mar 11 Mar",
        color: "#22c55e",
        activities: [
          { name: "Uji", coords: [34.8907, 135.8080], notes: "Ciudad del té" },
          { name: "Nintendo Museum", coords: [34.9378, 135.7583], notes: "Entradas ya compradas 14/14:30" },
          { name: "Fushimi Inari Taisha", coords: [34.9671, 135.7727], notes: "Lindo a la noche" },
          { name: "Templo Komyo-in", coords: [34.9691, 135.7733], notes: "Muy lindo a la tardecita" },
          { name: "Río Kamo", coords: [35.0000, 135.7700], notes: null }
        ]
      },
      "2025-03-12": {
        label: "Mié 12 Mar",
        color: "#06b6d4",
        activities: [
          { name: "Kiyomizu-dera", coords: [34.9949, 135.7850], notes: null },
          { name: "Ishibe Alley", coords: [34.9978, 135.7807], notes: null },
          { name: "Ninenzaka & Sanneizaka", coords: [34.9966, 135.7801], notes: "MUCHÍSIMA GENTE" },
          { name: "Yasaka Koshindo", coords: [34.9965, 135.7785], notes: null },
          { name: "Kawai Kanjiro's House", coords: [34.9932, 135.7791], notes: null }
        ]
      },
      "2025-03-13": {
        label: "Jue 13 Mar",
        color: "#8b5cf6",
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
    dates: "14-17 Mar 2025",
    days: {
      "2025-03-14": {
        label: "Vie 14 Mar",
        color: "#ef4444",
        activities: [
          { name: "Check-in Hotel Shizutetsu", coords: [34.6789, 135.4983], notes: null },
          { name: "Dotonbori", coords: [34.6685, 135.5015], notes: null },
          { name: "Hozen-ji Temple", coords: [34.6688, 135.5037], notes: null },
          { name: "Kuromon Market", coords: [34.6639, 135.5068], notes: null },
          { name: "Santuario Namba Yasaka", coords: [34.6621, 135.4975], notes: null }
        ]
      },
      "2025-03-15": {
        label: "Sáb 15 Mar",
        color: "#22c55e",
        activities: [
          { name: "Osaka Castle - Walking Tour", coords: [34.6850, 135.5240], notes: "09:00 AM - Lawson S Otemae Rest House - Letrero Local Guide Stars" },
          { name: "Tenma & Tenmabashi", coords: [34.7025, 135.5130], notes: null },
          { name: "Osaka Tenmangu Shrine", coords: [34.7025, 135.5150], notes: null },
          { name: "Nakazaki", coords: [34.7075, 135.5033], notes: "Vintage y coffee hopping" }
        ]
      },
      "2025-03-16": {
        label: "Dom 16 Mar",
        color: "#3b82f6",
        activities: [
          { name: "Universal Studios Japan", coords: [34.6654, 135.4323], notes: "DÍA COMPLETO - Super Nintendo World" }
        ]
      },
      "2025-03-17": {
        label: "Lun 17 Mar (Opcional)",
        color: "#8b5cf6",
        activities: [
          { name: "Templo Katsuo-ji", coords: [34.8781, 135.4869], notes: "Ir temprano - Taxi hasta Dainichi Parking Lot" },
          { name: "Minoh Falls", coords: [34.8530, 135.4730], notes: "Caminar hacia el sur hasta Mino-o Station" }
        ]
      }
    }
  }
};

// Color palette for markers
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

// Initialize map for a city
function initCityMap(city) {
  const data = ITINERARY[city];
  if (!data) return;

  const map = L.map('map').setView(data.center, data.zoom);
  
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19
  }).addTo(map);

  // Store markers by day
  const markersByDay = {};
  const allMarkers = [];

  // Create day selector
  const daySelector = document.getElementById('day-selector');
  const days = Object.keys(data.days);
  
  days.forEach((dateKey, dayIndex) => {
    const day = data.days[dateKey];
    const btn = document.createElement('button');
    btn.className = 'day-btn';
    btn.textContent = day.label;
    btn.dataset.day = dateKey;
    btn.style.setProperty('--day-color', day.color);
    daySelector.appendChild(btn);

    markersByDay[dateKey] = [];

    day.activities.forEach((activity, idx) => {
      if (!activity.coords) return;

      const marker = L.marker(activity.coords, {
        icon: L.divIcon({
          className: 'custom-marker',
          html: `<div class="numbered-marker" style="background:${day.color}">${idx + 1}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        })
      });

      let popupContent = `<h4>${activity.name}</h4>`;
      popupContent += `<p><strong>${day.label}</strong></p>`;
      if (activity.notes) {
        popupContent += `<p>${activity.notes}</p>`;
      }

      marker.bindPopup(popupContent);
      markersByDay[dateKey].push(marker);
      allMarkers.push(marker);
    });
  });

  // Add hotel marker
  if (data.hotel && data.hotel.coords) {
    const hotelMarker = L.marker(data.hotel.coords, {
      icon: L.divIcon({
        className: 'custom-marker',
        html: `<div class="hotel-pin">H</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      })
    }).bindPopup(`<h4>🏨 ${data.hotel.name}</h4><p>Base de operaciones</p>`);
    hotelMarker.addTo(map);
  }

  // Show all markers by default
  allMarkers.forEach(m => m.addTo(map));

  // Day filter functionality
  let activeDay = null;
  
  daySelector.addEventListener('click', (e) => {
    if (!e.target.classList.contains('day-btn')) return;
    
    const selectedDay = e.target.dataset.day;
    
    // Toggle same day = show all
    if (activeDay === selectedDay) {
      activeDay = null;
      document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
      allMarkers.forEach(m => m.addTo(map));
      return;
    }

    activeDay = selectedDay;
    document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');

    // Hide all, show selected day
    allMarkers.forEach(m => map.removeLayer(m));
    markersByDay[selectedDay].forEach(m => m.addTo(map));

    // Fit bounds to visible markers
    if (markersByDay[selectedDay].length > 0) {
      const group = L.featureGroup(markersByDay[selectedDay]);
      map.fitBounds(group.getBounds().pad(0.2));
    }
  });

  // Generate legend
  generateLegend(city, data);

  return map;
}

// Generate legend HTML
function generateLegend(city, data) {
  const legendGrid = document.getElementById('legend-grid');
  if (!legendGrid) return;

  legendGrid.innerHTML = '';

  Object.keys(data.days).forEach((dateKey) => {
    const day = data.days[dateKey];
    
    day.activities.forEach((activity, idx) => {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `
        <div class="legend-icon" style="background:${day.color}; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; font-size:14px;">${idx + 1}</div>
        <div class="legend-text">
          <strong>${activity.name}</strong>
          <small>${day.label}${activity.notes ? ' • ' + activity.notes.substring(0, 50) + (activity.notes.length > 50 ? '...' : '') : ''}</small>
        </div>
      `;
      legendGrid.appendChild(item);
    });
  });

  // Add hotel to legend
  if (data.hotel) {
    const hotelBadge = document.getElementById('hotel-badge');
    if (hotelBadge) {
      hotelBadge.innerHTML = `🏨 <strong>Hotel:</strong> ${data.hotel.name}`;
    }
  }
}

// Initialize overview map (index page)
function initOverviewMap() {
  const map = L.map('map').setView([36.2, 137.5], 6);
  
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM &copy; CARTO',
    maxZoom: 19
  }).addTo(map);

  const cities = [
    { name: 'Tokyo', coords: [35.6762, 139.7050], dates: '22 Feb - 1 Mar', color: '#ef4444', link: 'tokyo.html' },
    { name: 'Nagoya', coords: [35.1815, 136.9066], dates: '2-4 Mar', color: '#f97316', link: 'nagoya.html' },
    { name: 'Takayama', coords: [36.1400, 137.2500], dates: '4-7 Mar', color: '#22c55e', link: 'takayama.html' },
    { name: 'Kyoto', coords: [35.0116, 135.7681], dates: '8-13 Mar', color: '#3b82f6', link: 'kyoto.html' },
    { name: 'Osaka', coords: [34.6937, 135.5023], dates: '14-17 Mar', color: '#8b5cf6', link: 'osaka.html' }
  ];

  cities.forEach((city, idx) => {
    L.marker(city.coords, {
      icon: L.divIcon({
        className: 'custom-marker',
        html: `<div class="numbered-marker" style="background:${city.color}; width:40px; height:40px; font-size:16px;">${idx + 1}</div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      })
    })
    .bindPopup(`<h4>${city.name}</h4><p>${city.dates}</p><p><a href="${city.link}" style="color:#3b82f6;">Ver itinerario →</a></p>`)
    .addTo(map);
  });

  // Draw route line
  const routeCoords = cities.map(c => c.coords);
  L.polyline(routeCoords, { color: '#3b82f6', weight: 2, opacity: 0.6, dashArray: '10, 10' }).addTo(map);
}

// Auto-init based on page
document.addEventListener('DOMContentLoaded', () => {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  const page = mapEl.dataset.city;
  if (page === 'overview') {
    initOverviewMap();
  } else if (page && ITINERARY[page]) {
    initCityMap(page);
  }
});
