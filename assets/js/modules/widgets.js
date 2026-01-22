// Enhanced Widgets Module - Weather with Max/Min, News, Events
import { ITINERARY } from './config.js';

const cache = { weather: { data: null, timestamp: 0, key: null }, news: { data: null, timestamp: 0, key: null }, events: { data: null, timestamp: 0, key: null } };
const CACHE_DURATION = 30 * 60 * 1000;
function isCacheValid(key, cacheKey) { return cache[key].data && cache[key].key === cacheKey && (Date.now() - cache[key].timestamp < CACHE_DURATION); }

export function initWidgets(cityKey) {
  const cityData = ITINERARY[cityKey];
  if (!cityData || !cityData.center) return;

  const pageCard = document.querySelector('.page-card');
  if (!pageCard) return;

  const widgetsSection = document.createElement('div');
  widgetsSection.className = 'widgets-section';
  widgetsSection.innerHTML = `
    <h3 class="widgets-title">Información Local: ${cityData.name}</h3>
    <div class="widgets-grid">
      <div class="widget-card" id="widget-weather">
        <div class="widget-header"><h4>Clima & Pronóstico</h4></div>
        <div class="widget-content widget-loading">Cargando clima...</div>
      </div>
      <div class="widget-card" id="widget-news">
        <div class="widget-header"><h4>Noticias Locales</h4></div>
        <div class="widget-content widget-loading">Cargando noticias...</div>
      </div>
      <div class="widget-card" id="widget-events">
        <div class="widget-header"><h4>Próximos Eventos</h4></div>
        <div class="widget-content widget-loading">Buscando eventos...</div>
      </div>
    </div>
  `;
  pageCard.appendChild(widgetsSection);

  fetchWeather(cityData.center[0], cityData.center[1]);
  setTimeout(() => fetchNews(cityData.name), 200);
  setTimeout(() => fetchEvents(cityData.name), 400);
}

async function fetchWeather(lat, lon) {
  const container = document.querySelector('#widget-weather .widget-content');
  if (!container) return;
  const cacheKey = `weather_${lat}_${lon}`;
  if (isCacheValid('weather', cacheKey)) { renderWeather(container, cache.weather.data); return; }

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=5`);
    if (!response.ok) throw new Error('API error');
    const data = await response.json();
    cache.weather = { data, timestamp: Date.now(), key: cacheKey };
    renderWeather(container, data);
  } catch (e) {
    container.innerHTML = `<div class="widget-error"><p style="color:var(--text-tertiary)">No se pudo cargar el clima</p><button onclick="location.reload()" class="widget-retry-btn">Reintentar</button></div>`;
  }
}

function renderWeather(container, data) {
  const currentTemp = Math.round(data.current.temperature_2m);
  const feelsLike = Math.round(data.current.apparent_temperature);
  const humidity = data.current.relative_humidity_2m;
  const windSpeed = Math.round(data.current.wind_speed_10m);
  const currentCode = data.current.weather_code;
  const condition = getWeatherCondition(currentCode);

  let forecastHtml = '';
  for (let i = 1; i <= 4; i++) {
    const d = {
      date: new Date(data.daily.time[i]).toLocaleDateString('es-ES', { weekday: 'short' }),
      min: Math.round(data.daily.temperature_2m_min[i]),
      max: Math.round(data.daily.temperature_2m_max[i]),
      code: data.daily.weather_code[i],
      precip: data.daily.precipitation_probability_max[i]
    };
    forecastHtml += `
      <div class="forecast-day">
        <div class="forecast-date">${d.date}</div>
        <div class="forecast-icon">${getWeatherIcon(d.code)}</div>
        <div class="forecast-temp"><span class="forecast-max">${d.max}°</span><span class="forecast-min">${d.min}°</span></div>
        ${d.precip > 20 ? `<div class="forecast-precip">${d.precip}%</div>` : ''}
      </div>
    `;
  }

  container.innerHTML = `
    <div class="weather-current">
      <div class="weather-temp">${currentTemp}°</div>
      <div class="weather-condition">
        <div class="weather-icon-large">${getWeatherIcon(currentCode)}</div>
        <span>${condition}</span>
      </div>
    </div>
    <div class="weather-details">
      <span>Sensación ${feelsLike}°</span>
      <span>Humedad ${humidity}%</span>
      <span>Viento ${windSpeed} km/h</span>
    </div>
    <div class="weather-forecast">${forecastHtml}</div>
  `;
}

function getWeatherCondition(code) {
  const c = { 0: 'Despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado', 3: 'Nublado', 45: 'Niebla', 48: 'Niebla helada', 51: 'Llovizna ligera', 53: 'Llovizna', 55: 'Llovizna intensa', 61: 'Lluvia ligera', 63: 'Lluvia', 65: 'Lluvia intensa', 71: 'Nieve ligera', 73: 'Nieve', 75: 'Nieve intensa', 80: 'Chubascos', 81: 'Chubascos moderados', 82: 'Chubascos fuertes', 95: 'Tormenta', 96: 'Tormenta con granizo', 99: 'Tormenta fuerte' };
  return c[code] || 'Variable';
}

function getWeatherIcon(code) {
  if (code === 0) return '☀️';
  if (code <= 3) return '⛅';
  if (code <= 48) return '🌫️';
  if (code <= 57) return '🌧️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  if (code <= 99) return '⚡';
  return '☁️';
}

async function fetchNews(city) {
  const container = document.querySelector('#widget-news .widget-content');
  if (!container) return;
  const cacheKey = `news_${city}`;
  if (isCacheValid('news', cacheKey)) { renderNews(container, cache.news.data); return; }

  try {
    const query = `${city} Japan tourism culture`;
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`);
    const data = await response.json();
    if (data.status !== 'ok' || !data.items?.length) throw new Error('No news');
    cache.news = { data: data.items, timestamp: Date.now(), key: cacheKey };
    renderNews(container, data.items);
  } catch (e) {
    container.innerHTML = `<p style="color:var(--text-tertiary); font-size:13px;">No se encontraron noticias recientes.</p><p style="color:var(--text-tertiary); font-size:12px; margin-top:8px;"><a href="https://news.google.com/search?q=${encodeURIComponent(city + ' Japan')}" target="_blank" rel="noopener" style="color:var(--accent);">Buscar en Google News →</a></p>`;
  }
}

function renderNews(container, items) {
  let html = '<ul class="widget-list">';
  items.slice(0, 4).forEach(item => {
    const cleanTitle = item.title.split(' - ')[0];
    const date = new Date(item.pubDate).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
    const source = item.author || item.title.split(' - ').pop() || 'News';
    html += `<li class="widget-list-item"><div class="widget-text-content"><a href="${item.link}" target="_blank" rel="noopener" class="widget-link"><div class="widget-link-title">${cleanTitle}</div><div class="widget-meta"><span>${source}</span><span>${date}</span></div></a></div></li>`;
  });
  container.innerHTML = html + '</ul>';
}

async function fetchEvents(city) {
  const container = document.querySelector('#widget-events .widget-content');
  if (!container) return;
  const cacheKey = `events_${city}`;
  if (isCacheValid('events', cacheKey)) { renderEvents(container, cache.events.data, city); return; }

  try {
    const query = `Events festivals ${city} Japan ${new Date().getFullYear()}`;
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`);
    const data = await response.json();
    if (data.status !== 'ok' || !data.items?.length) throw new Error('No events');
    cache.events = { data: data.items, timestamp: Date.now(), key: cacheKey };
    renderEvents(container, data.items, city);
  } catch (e) {
    container.innerHTML = `<p style="color:var(--text-tertiary); font-size:13px;">Información no disponible temporalmente.</p><p style="color:var(--text-tertiary); font-size:12px; margin-top:8px;"><a href="https://www.japan-guide.com/e/e2063.html" target="_blank" rel="noopener" style="color:var(--accent);">Ver eventos en Japan Guide →</a></p>`;
  }
}

function renderEvents(container, items, city) {
  let html = '<ul class="widget-list">';
  items.slice(0, 4).forEach(item => {
    const cleanTitle = item.title.split(' - ')[0];
    const date = new Date(item.pubDate).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
    const calUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(cleanTitle)}&details=${encodeURIComponent(item.link)}&location=${encodeURIComponent(city + ', Japan')}`;
    html += `<li class="widget-list-item"><div class="widget-text-content"><a href="${item.link}" target="_blank" rel="noopener" class="widget-link"><div class="widget-link-title">${cleanTitle}</div><div class="widget-meta"><span>Publicado: ${date}</span></div></a></div><a href="${calUrl}" target="_blank" rel="noopener" class="calendar-btn" title="Agregar a Google Calendar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><line x1="12" y1="14" x2="12" y2="18"></line><line x1="10" y1="16" x2="14" y2="16"></line></svg></a></li>`;
  });
  container.innerHTML = html + '</ul>';
}
