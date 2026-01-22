import { getCache, setCache, createElement } from './utils.js';
import { ITINERARY } from '../data/itinerary.js';

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
  pageCard.appendChild(section);

  // Lazy loading logic could go here, but setTimeout is fine for simple stagger
  fetchWeather(cityData.center[0], cityData.center[1]);
  setTimeout(() => fetchNews(cityData.name), 300);
  setTimeout(() => fetchEvents(cityData.name), 600);
}

async function fetchWeather(lat, lon) {
  const container = document.querySelector('#widget-weather .widget-content');
  if (!container) return;
  const cacheKey = `weather_${lat}_${lon}`;
  
  const cached = getCache(cacheKey);
  if (cached) return renderWeather(container, cached);

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=5`);
    if (!res.ok) throw new Error('API Error');
    const data = await res.json();
    setCache(cacheKey, data);
    renderWeather(container, data);
  } catch (e) {
    container.innerHTML = `<div class="widget-error"><p>No disponible</p></div>`;
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
    forecastHtml += `
      <div class="forecast-day">
        <div class="forecast-date">${date}</div>
        <div class="forecast-icon">${getWeatherIcon(daily.weather_code[i])}</div>
        <div class="forecast-temp"><span class="forecast-max">${max}°</span><span class="forecast-min">${min}°</span></div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="weather-current">
      <div class="weather-temp">${currentTemp}°</div>
      <div class="weather-condition">
        <div class="weather-icon-large">${getWeatherIcon(current.weather_code)}</div>
        <span>${condition}</span>
      </div>
    </div>
    <div class="weather-forecast">${forecastHtml}</div>
  `;
}

function getWeatherCondition(code) {
  const codes = { 0: 'Despejado', 1: 'Poco nuboso', 2: 'Parcial nublado', 3: 'Nublado', 45: 'Niebla', 61: 'Lluvia', 71: 'Nieve', 95: 'Tormenta' };
  return codes[code] || 'Variable';
}

function getWeatherIcon(code) {
  if (code === 0) return '☀️';
  if (code <= 3) return '⛅';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  return '☁️';
}

async function fetchNews(city) {
  const container = document.querySelector('#widget-news .widget-content');
  if (!container) return;
  const cacheKey = `news_${city}`;
  
  const cached = getCache(cacheKey);
  if (cached) return renderList(container, cached, 'news');

  try {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(city + ' Japan tourism')}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`);
    const data = await res.json();
    if (data.status === 'ok') {
      setCache(cacheKey, data.items);
      renderList(container, data.items, 'news');
    } else throw new Error();
  } catch (e) {
    container.innerHTML = '<p class="widget-loading">No se encontraron noticias.</p>';
  }
}

async function fetchEvents(city) {
  const container = document.querySelector('#widget-events .widget-content');
  if (!container) return;
  const cacheKey = `events_${city}`;
  
  const cached = getCache(cacheKey);
  if (cached) return renderList(container, cached, 'events', city);

  try {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent('Events festivals ' + city + ' Japan ' + new Date().getFullYear())}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`);
    const data = await res.json();
    if (data.status === 'ok') {
      setCache(cacheKey, data.items);
      renderList(container, data.items, 'events', city);
    } else throw new Error();
  } catch (e) {
    container.innerHTML = '<p class="widget-loading">Información no disponible.</p>';
  }
}

function renderList(container, items, type, city = '') {
  let html = '<ul class="widget-list">';
  items.slice(0, 4).forEach(item => {
    const title = item.title.split(' - ')[0];
    const date = new Date(item.pubDate).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
    let extraBtn = '';
    
    if (type === 'events') {
      const calUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&details=${encodeURIComponent(item.link)}&location=${encodeURIComponent(city + ', Japan')}`;
      extraBtn = `<a href="${calUrl}" target="_blank" class="calendar-btn" title="Agendar">📅</a>`;
    }

    html += `
      <li class="widget-list-item">
        <div class="widget-text-content">
          <a href="${item.link}" target="_blank" class="widget-link">
            <div class="widget-link-title">${title}</div>
            <div class="widget-meta"><span>${date}</span></div>
          </a>
        </div>
        ${extraBtn}
      </li>`;
  });
  container.innerHTML = html + '</ul>';
}