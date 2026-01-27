import type { NewsItem, WeatherData } from '@/types';
import { ITINERARY } from '@/data/itinerary';
import { getCache, setCache, createElement, cleanTitle, formatDate, isValidItem, createCalendarUrl } from './utils';

const MAX_ITEMS = 4;

export function initWidgets(cityKey: string): void {
  const cityData = ITINERARY[cityKey];
  if (!cityData?.center) return;

  const pageCard = document.querySelector('.page-card');
  if (!pageCard || pageCard.querySelector('.widgets-section')) return;

  const section = createWidgetsSection(cityData.name);
  pageCard.appendChild(section);

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          loadWidgets(cityData.center, cityData.name);
          observer.disconnect();
        }
      });
    },
    { rootMargin: '100px' }
  );
  observer.observe(section);
}

function createWidgetsSection(cityName: string): HTMLElement {
  const section = createElement('section', 'widgets-section');
  section.setAttribute('aria-label', `Información local de ${cityName}`);
  section.innerHTML = `
    <h3 class="widgets-title">Información Local: ${cityName}</h3>
    <div class="widgets-grid" role="region" aria-live="polite">
      <article class="widget-card" id="widget-weather" aria-labelledby="weather-title">
        <div class="widget-header"><h4 id="weather-title">Clima & Pronóstico</h4></div>
        <div class="widget-content" aria-busy="true"><div class="loader" role="status"><span class="sr-only">Cargando clima...</span></div></div>
      </article>
      <article class="widget-card" id="widget-news" aria-labelledby="news-title">
        <div class="widget-header"><h4 id="news-title">Noticias</h4></div>
        <div class="widget-content" aria-busy="true"><div class="loader" role="status"><span class="sr-only">Cargando noticias...</span></div></div>
      </article>
      <article class="widget-card" id="widget-events" aria-labelledby="events-title">
        <div class="widget-header"><h4 id="events-title">Eventos</h4></div>
        <div class="widget-content" aria-busy="true"><div class="loader" role="status"><span class="sr-only">Cargando eventos...</span></div></div>
      </article>
    </div>`;
  return section;
}

async function loadWidgets(center: [number, number], cityName: string): Promise<void> {
  await Promise.all([
    fetchWeather(center[0], center[1]),
    loadDynamicData(cityName, 'news'),
    loadDynamicData(cityName, 'events')
  ]);
}

async function fetchWeather(lat: number, lon: number): Promise<void> {
  const container = document.querySelector('#widget-weather .widget-content') as HTMLElement;
  if (!container) return;
  
  const cacheKey = `weather_${lat}_${lon}`;
  const cached = getCache<WeatherData>(cacheKey);
  if (cached) { renderWeather(container, cached); return; }

  try {
    const params = new URLSearchParams({
      latitude: String(lat), longitude: String(lon),
      current: 'temperature_2m,weather_code',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      timezone: 'Asia/Tokyo', forecast_days: '5'
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!res.ok) throw new Error('Weather fetch failed');
    const data = await res.json() as WeatherData;
    setCache(cacheKey, data);
    renderWeather(container, data);
  } catch {
    renderError(container, 'Clima no disponible');
  }
}

function renderWeather(container: HTMLElement, data: WeatherData): void {
  const { current, daily } = data;
  const currentTemp = Math.round(current.temperature_2m);
  const condition = getWeatherCondition(current.weather_code);
  
  const forecastDays = daily.time.slice(1, 5).map((time, i) => {
    const idx = i + 1;
    const date = new Date(time).toLocaleDateString('es-ES', { weekday: 'short' });
    const min = Math.round(daily.temperature_2m_min[idx]);
    const max = Math.round(daily.temperature_2m_max[idx]);
    const icon = getWeatherIcon(daily.weather_code[idx]);
    return `<div class="forecast-day" role="listitem">
      <div class="forecast-date">${date}</div>
      <div class="forecast-icon" aria-hidden="true">${icon}</div>
      <div class="forecast-temp">
        <span class="forecast-max">${max}°</span>
        <span class="forecast-min">${min}°</span>
      </div>
    </div>`;
  }).join('');

  container.setAttribute('aria-busy', 'false');
  container.innerHTML = `
    <div class="weather-current">
      <div class="weather-temp" aria-label="Temperatura actual">${currentTemp}°</div>
      <div class="weather-condition">
        <div class="weather-icon-large" aria-hidden="true">${getWeatherIcon(current.weather_code)}</div>
        <span>${condition}</span>
      </div>
    </div>
    <div class="weather-forecast" role="list" aria-label="Pronóstico de 4 días">${forecastDays}</div>`;
}

const WEATHER_CONDITIONS: Record<number, string> = {
  0: 'Despejado', 1: 'Poco nuboso', 2: 'Parcial nublado', 3: 'Nublado',
  45: 'Niebla', 48: 'Niebla helada', 51: 'Llovizna ligera', 53: 'Llovizna', 55: 'Llovizna intensa',
  61: 'Lluvia ligera', 63: 'Lluvia', 65: 'Lluvia intensa',
  71: 'Nieve ligera', 73: 'Nieve', 75: 'Nieve intensa',
  80: 'Chubascos', 81: 'Chubascos moderados', 82: 'Chubascos fuertes',
  95: 'Tormenta', 96: 'Tormenta con granizo', 99: 'Tormenta severa'
};

function getWeatherCondition(code: number): string {
  return WEATHER_CONDITIONS[code] ?? 'Variable';
}

/**
 * Minimalist SVG weather icons
 * Clean, modern line-art style
 */
function getWeatherIcon(code: number): string {
  // Clear / Sunny
  if (code === 0) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2"/>
      <path d="M12 20v2"/>
      <path d="M4.93 4.93l1.41 1.41"/>
      <path d="M17.66 17.66l1.41 1.41"/>
      <path d="M2 12h2"/>
      <path d="M20 12h2"/>
      <path d="M6.34 17.66l-1.41 1.41"/>
      <path d="M19.07 4.93l-1.41 1.41"/>
    </svg>`;
  }
  
  // Partly cloudy (1-3)
  if (code >= 1 && code <= 3) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2v2"/>
      <path d="M4.93 4.93l1.41 1.41"/>
      <path d="M2 12h2"/>
      <circle cx="12" cy="10" r="4"/>
      <path d="M8 18h10a4 4 0 0 0 0-8h-.5A5.5 5.5 0 0 0 7 10.5v.5A4 4 0 0 0 8 18z"/>
    </svg>`;
  }
  
  // Fog (45-48)
  if (code >= 45 && code <= 48) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 12h16"/>
      <path d="M4 8h12"/>
      <path d="M8 16h12"/>
      <path d="M6 20h8"/>
      <path d="M10 4h4"/>
    </svg>`;
  }
  
  // Drizzle (51-55)
  if (code >= 51 && code <= 55) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 14h10a4 4 0 0 0 0-8h-.5A5.5 5.5 0 0 0 7 6.5v.5A4 4 0 0 0 8 14z"/>
      <path d="M8 18v1"/>
      <path d="M12 18v1"/>
      <path d="M16 18v1"/>
    </svg>`;
  }
  
  // Rain (61-65, 80-82)
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 13h10a4 4 0 0 0 0-8h-.5A5.5 5.5 0 0 0 7 5.5v.5A4 4 0 0 0 8 13z"/>
      <path d="M8 17v2"/>
      <path d="M12 17v2"/>
      <path d="M16 17v2"/>
      <path d="M10 21v1"/>
      <path d="M14 21v1"/>
    </svg>`;
  }
  
  // Snow (71-75)
  if (code >= 71 && code <= 75) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 13h10a4 4 0 0 0 0-8h-.5A5.5 5.5 0 0 0 7 5.5v.5A4 4 0 0 0 8 13z"/>
      <path d="M8 17l.5.5m-.5-.5l-.5.5"/>
      <path d="M12 18l.5.5m-.5-.5l-.5.5"/>
      <path d="M16 17l.5.5m-.5-.5l-.5.5"/>
      <path d="M10 21l.5.5m-.5-.5l-.5.5"/>
      <path d="M14 21l.5.5m-.5-.5l-.5.5"/>
    </svg>`;
  }
  
  // Thunderstorm (95-99)
  if (code >= 95 && code <= 99) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 11h10a4 4 0 0 0 0-8h-.5A5.5 5.5 0 0 0 7 3.5v.5A4 4 0 0 0 8 11z"/>
      <path d="M13 11l-2 5h3l-2 5"/>
    </svg>`;
  }
  
  // Default: Cloudy
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 18h10a4 4 0 0 0 0-8h-.5A5.5 5.5 0 0 0 7 10.5v.5A4 4 0 0 0 8 18z"/>
  </svg>`;
}

async function loadDynamicData(city: string, type: 'news' | 'events'): Promise<void> {
  const container = document.querySelector(`#widget-${type} .widget-content`) as HTMLElement;
  if (!container) return;
  
  const cacheKey = `${type}_v5_${city}`;
  const cached = getCache<NewsItem[]>(cacheKey);
  if (cached?.length) { renderList(container, cached, type, city); return; }

  try {
    const query = type === 'news' ? `"${city}" Japan tourism` : `${city} Japan festival event`;
    let items = await fetchWithProxy(query, 'allorigins');
    if (!items?.length) items = await fetchWithProxy(query, 'corsproxy');
    
    const filteredItems = items?.filter(isValidItem) ?? [];
    if (filteredItems.length > 0) {
      const finalItems = filteredItems.slice(0, MAX_ITEMS);
      setCache(cacheKey, finalItems);
      renderList(container, finalItems, type, city);
    } else {
      renderEmptyState(container, type);
    }
  } catch {
    renderError(container, 'Recarga para ver contenido');
  }
}

async function fetchWithProxy(query: string, proxyType: 'allorigins' | 'corsproxy'): Promise<NewsItem[]> {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const fetchUrl = proxyType === 'allorigins'
    ? `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}&_=${Date.now()}`
    : `https://corsproxy.io/?${encodeURIComponent(rssUrl)}`;

  try {
    const response = await fetch(fetchUrl);
    if (!response.ok) return [];
    const xmlText = proxyType === 'allorigins'
      ? (await response.json() as { contents: string }).contents
      : await response.text();
    if (!xmlText) return [];
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    return Array.from(xmlDoc.querySelectorAll('item')).map(item => ({
      title: item.querySelector('title')?.textContent ?? '',
      link: item.querySelector('link')?.textContent ?? '',
      pubDate: item.querySelector('pubDate')?.textContent ?? '',
      source: item.querySelector('source')?.textContent ?? 'Web'
    }));
  } catch { return []; }
}

function renderList(container: HTMLElement, items: NewsItem[], type: 'news' | 'events', city: string): void {
  const listItems = items.map(item => {
    const title = cleanTitle(item.title);
    const date = formatDate(item.pubDate);
    let actionBtn = '';
    if (type === 'events') {
      const calUrl = createCalendarUrl(title, item.link, `${city}, Japan`);
      actionBtn = `<a href="${calUrl}" target="_blank" rel="noopener" class="calendar-btn" title="Agregar al calendario" aria-label="Agregar ${title} al calendario"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg></a>`;
    }
    return `<li class="widget-list-item"><div class="widget-text-content"><a href="${item.link}" target="_blank" rel="noopener" class="widget-link"><span class="widget-link-title">${title}</span><span class="widget-meta"><span>${item.source}</span><time datetime="${item.pubDate}">${date}</time></span></a></div>${actionBtn}</li>`;
  }).join('');
  container.setAttribute('aria-busy', 'false');
  container.innerHTML = `<ul class="widget-list" role="list">${listItems}</ul>`;
}

function renderEmptyState(container: HTMLElement, type: 'news' | 'events'): void {
  container.setAttribute('aria-busy', 'false');
  container.innerHTML = `<p class="widget-empty" role="status">No se encontraron ${type === 'news' ? 'noticias' : 'eventos'} recientes.</p>`;
}

function renderError(container: HTMLElement, message: string): void {
  container.setAttribute('aria-busy', 'false');
  container.innerHTML = `<p class="widget-empty widget-error" role="alert">${message}</p>`;
}
