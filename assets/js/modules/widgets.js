import { getCache, setCache, createElement, cleanTitle, formatDate, isValidItem } from './utils.js';
import { ITINERARY } from '../data/itinerary.js'; // Asegúrate de que la ruta a config/itinerary sea correcta según tu estructura

export function initWidgets(cityKey) {
  const cityData = ITINERARY[cityKey];
  if (!cityData || !cityData.center) return;

  const pageCard = document.querySelector('.page-card');
  if (!pageCard || pageCard.querySelector('.widgets-section')) return;

  const section = createElement('div', 'widgets-section');
  section.innerHTML = `
    <h3 class="widgets-title">Información Local: ${cityData.name}</h3>
    <div class="widgets-grid">
      <div class="widget-card" id="widget-weather">
        <div class="widget-header"><h4>Clima & Pronóstico</h4></div>
        <div class="widget-content"><div class="loader"></div></div>
      </div>
      <div class="widget-card" id="widget-news">
        <div class="widget-header"><h4>Noticias</h4></div>
        <div class="widget-content"><div class="loader"></div></div>
      </div>
      <div class="widget-card" id="widget-events">
        <div class="widget-header"><h4>Eventos</h4></div>
        <div class="widget-content"><div class="loader"></div></div>
      </div>
    </div>
  `;
  pageCard.appendChild(section);

  // Iniciar cargas con un pequeño escalonamiento para no saturar
  fetchWeather(cityData.center[0], cityData.center[1]);
  setTimeout(() => loadDynamicData(cityData.name, 'news'), 100);
  setTimeout(() => loadDynamicData(cityData.name, 'events'), 300);
}

async function loadDynamicData(city, type) {
  const container = document.querySelector(`#widget-${type} .widget-content`);
  const cacheKey = `${type}_v5_${city}`;
  
  const cached = getCache(cacheKey);
  if (cached && cached.length > 0) {
    renderList(container, cached, type, city);
    return;
  }

  try {
    let query = type === 'news' ? `"${city}" Japan tourism` : `${city} Japan festival event`;
    
    // INTENTO 1
    let items = await fetchWithProxy(query, 'allorigins');
    
    // INTENTO 2 (Silencioso)
    if (!items || items.length === 0) {
      // Solo logueamos info, no error
      console.info('Proxy primario sin datos, cambiando a respaldo...'); 
      items = await fetchWithProxy(query, 'corsproxy');
    }

    const filteredItems = items ? items.filter(item => isValidItem(item, city)) : [];

    if (filteredItems.length > 0) {
      const finalItems = filteredItems.slice(0, 4);
      setCache(cacheKey, finalItems);
      renderList(container, finalItems, type, city);
    } else {
      container.innerHTML = `<p class="widget-loading" style="font-size:13px; color:var(--text-tertiary)">No se encontraron ${type === 'news' ? 'noticias' : 'eventos'} recientes.</p>`;
    }

  } catch (e) {
    console.warn("Widget fetch failed:", e.message);
    container.innerHTML = `<p class="widget-loading" style="font-size:13px; color:var(--text-tertiary)">Recarga para ver contenido.</p>`;
  }
}

async function fetchWithProxy(query, proxyType) {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  let fetchUrl = '';

  if (proxyType === 'allorigins') {
    // Usamos timestamp para evitar caché del proxy si falló antes
    fetchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}&_=${Date.now()}`;
  } else {
    // Backup Proxy
    fetchUrl = `https://corsproxy.io/?${encodeURIComponent(rssUrl)}`;
  }

  try {
    const response = await fetch(fetchUrl);
    if (!response.ok) return [];
    
    let xmlText = '';
    if (proxyType === 'allorigins') {
      const json = await response.json();
      xmlText = json.contents;
    } else {
      xmlText = await response.text();
    }

    if (!xmlText) return [];

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    const items = Array.from(xmlDoc.querySelectorAll("item"));

    return items.map(item => ({
      title: item.querySelector("title")?.textContent || "",
      link: item.querySelector("link")?.textContent || "",
      pubDate: item.querySelector("pubDate")?.textContent || "",
      source: item.querySelector("source")?.textContent || "Web"
    }));
  } catch (e) {
    return [];
  }
}

function renderList(container, items, type, city) {
  let html = '<ul class="widget-list">';
  items.forEach(item => {
    const title = cleanTitle(item.title);
    const date = formatDate(item.pubDate);
    const source = item.source;
    let actionBtn = '';
    
    if (type === 'events') {
      const calUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&details=${encodeURIComponent(item.link)}&location=${encodeURIComponent(city + ', Japan')}`;
      actionBtn = `<a href="${calUrl}" target="_blank" rel="noopener" class="calendar-btn" title="Agendar">📅</a>`;
    }

    html += `
      <li class="widget-list-item">
        <div class="widget-text-content">
          <a href="${item.link}" target="_blank" rel="noopener" class="widget-link">
            <div class="widget-link-title">${title}</div>
            <div class="widget-meta"><span style="opacity:0.7">${source}</span><span>${date}</span></div>
          </a>
        </div>
        ${actionBtn}
      </li>`;
  });
  container.innerHTML = html + '</ul>';
}

async function fetchWeather(lat, lon) {
  const container = document.querySelector('#widget-weather .widget-content');
  if (!container) return;
  const cacheKey = `weather_${lat}_${lon}`;
  
  const cached = getCache(cacheKey);
  if (cached) { renderWeather(container, cached); return; }

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FTokyo&forecast_days=5`);
    const data = await res.json();
    setCache(cacheKey, data);
    renderWeather(container, data);
  } catch (e) {
    container.innerHTML = `<p class="widget-loading">Clima no disponible</p>`;
  }
}

function renderWeather(container, data) {
  const { current, daily } = data;
  const currentTemp = Math.round(current.temperature_2m);
  const condition = getWeatherCondition(current.weather_code);
  let forecastHtml = '';
  for (let i = 1; i <= 4; i++) {
    const date = new Date(daily.time[i]).toLocaleDateString('es-ES', { weekday: 'short' });
    const min = Math.round(daily.temperature_2m_min[i]);
    const max = Math.round(daily.temperature_2m_max[i]);
    forecastHtml += `<div class="forecast-day"><div class="forecast-date">${date}</div><div class="forecast-icon">${getWeatherIcon(daily.weather_code[i])}</div><div class="forecast-temp"><span class="forecast-max">${max}°</span><span class="forecast-min">${min}°</span></div></div>`;
  }
  container.innerHTML = `<div class="weather-current"><div class="weather-temp">${currentTemp}°</div><div class="weather-condition"><div class="weather-icon-large">${getWeatherIcon(current.weather_code)}</div><span>${condition}</span></div></div><div class="weather-forecast">${forecastHtml}</div>`;
}

function getWeatherCondition(code) {
  const c = { 0: 'Despejado', 1: 'Poco nuboso', 2: 'Parcial nublado', 3: 'Nublado', 45: 'Niebla', 51: 'Llovizna', 61: 'Lluvia', 71: 'Nieve', 95: 'Tormenta' };
  return c[code] || 'Variable';
}

function getWeatherIcon(code) {
  if (code === 0) return '☀️';
  if (code <= 3) return '⛅';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  return '☁️';
}