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
  section.setAttribute('aria-label', `Local information for ${cityName}`);
  section.innerHTML = `
    <h3 class="widgets-title">Local Information: ${cityName}</h3>
    <div class="widgets-grid" role="region" aria-live="polite">
      <article class="widget-card" id="widget-weather" aria-labelledby="weather-title">
        <div class="widget-header"><h4 id="weather-title">Weather & Forecast</h4></div>
        <div class="widget-content" aria-busy="true"><div class="loader" role="status"><span class="sr-only">Loading weather...</span></div></div>
      </article>
      <article class="widget-card" id="widget-news" aria-labelledby="news-title">
        <div class="widget-header"><h4 id="news-title">News</h4></div>
        <div class="widget-content" aria-busy="true"><div class="loader" role="status"><span class="sr-only">Loading news...</span></div></div>
      </article>
      <article class="widget-card" id="widget-events" aria-labelledby="events-title">
        <div class="widget-header"><h4 id="events-title">Events</h4></div>
        <div class="widget-content" aria-busy="true"><div class="loader" role="status"><span class="sr-only">Loading events...</span></div></div>
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
    renderError(container, 'Weather unavailable');
  }
}

function renderWeather(container: HTMLElement, data: WeatherData): void {
  const { current, daily } = data;
  const currentTemp = Math.round(current.temperature_2m);
  const condition = getWeatherCondition(current.weather_code);
  
  const forecastDays = daily.time.slice(1, 5).map((time, i) => {
    const idx = i + 1;
    const date = new Date(time).toLocaleDateString('en-US', { weekday: 'short' });
    const min = Math.round(daily.temperature_2m_min[idx]);
    const max = Math.round(daily.temperature_2m_max[idx]);
    const icon = getWeatherIcon(daily.weather_code[idx]);
    return `<div class="forecast-day" role="listitem"><div class="forecast-date">${date}</div><div class="forecast-icon" aria-hidden="true">${icon}</div><div class="forecast-temp"><span class="forecast-max">${max}°</span><span class="forecast-min">${min}°</span></div></div>`;
  }).join('');

  container.setAttribute('aria-busy', 'false');
  container.innerHTML = `
    <div class="weather-current">
      <div class="weather-temp" aria-label="Current temperature">${currentTemp}°</div>
      <div class="weather-condition"><div class="weather-icon-large" aria-hidden="true">${getWeatherIcon(current.weather_code)}</div><span>${condition}</span></div>
    </div>
    <div class="weather-forecast" role="list" aria-label="4-day forecast">${forecastDays}</div>`;
}

const WEATHER_CONDITIONS: Record<number, string> = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy',
  45: 'Fog', 51: 'Drizzle', 61: 'Rain', 71: 'Snow', 95: 'Thunderstorm'
};

function getWeatherCondition(code: number): string {
  return WEATHER_CONDITIONS[code] ?? 'Variable';
}

function getWeatherIcon(code: number): string {
  // Iconos SVG minimalistas en lugar de emojis
  if (code === 0) {
    // Sol
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
  }
  if (code <= 3) {
    // Parcialmente nublado
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`;
  }
  if (code <= 48) {
    // Niebla
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><path d="M3 15h18M3 9h18M3 12h18"/></svg>`;
  }
  if (code <= 67) {
    // Lluvia
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><line x1="8" y1="13" x2="8" y2="21"/><line x1="16" y1="13" x2="16" y2="21"/><line x1="12" y1="15" x2="12" y2="23"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/></svg>`;
  }
  // Generic cloudy
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`;
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
    renderError(container, 'Reload to view content');
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
      actionBtn = `<a href="${calUrl}" target="_blank" rel="noopener" class="calendar-btn" title="Add to calendar" aria-label="Add ${title} to calendar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg></a>`;
    }
    return `<li class="widget-list-item"><div class="widget-text-content"><a href="${item.link}" target="_blank" rel="noopener" class="widget-link"><span class="widget-link-title">${title}</span><span class="widget-meta"><span>${item.source}</span><time datetime="${item.pubDate}">${date}</time></span></a></div>${actionBtn}</li>`;
  }).join('');
  container.setAttribute('aria-busy', 'false');
  container.innerHTML = `<ul class="widget-list" role="list">${listItems}</ul>`;
}

function renderEmptyState(container: HTMLElement, type: 'news' | 'events'): void {
  container.setAttribute('aria-busy', 'false');
  container.innerHTML = `<p class="widget-empty" role="status">No recent ${type === 'news' ? 'news' : 'events'} found.</p>`;
}

function renderError(container: HTMLElement, message: string): void {
  container.setAttribute('aria-busy', 'false');
  container.innerHTML = `<p class="widget-empty widget-error" role="alert">${message}</p>`;
}
