import type { NewsItem, WeatherData } from '@/types';
import { ITINERARY } from '@/data/itinerary';
import { getCache, setCache, clearCache, createElement, cleanTitle, formatDate, isValidItem, createCalendarUrl } from './utils';
import { formatIsoDate } from './dates';
import { getWeatherCondition, getWeatherIcon } from './weatherIcons';

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
  if (cached) {
    if (isWeatherData(cached)) { renderWeather(container, cached); return; }
    clearCache(cacheKey); // corrupted entry: drop it and refetch
  }

  try {
    const params = new URLSearchParams({
      latitude: String(lat), longitude: String(lon),
      current: 'temperature_2m,weather_code',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      timezone: 'Asia/Tokyo', forecast_days: '5'
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!res.ok) throw new Error('Weather fetch failed');
    const data = await res.json() as unknown;
    if (!isWeatherData(data)) throw new Error('Unexpected weather payload');
    setCache(cacheKey, data);
    renderWeather(container, data);
  } catch {
    renderError(container, 'Weather unavailable');
  }
}

function isWeatherData(d: unknown): d is WeatherData {
  const w = d as Partial<WeatherData> | null;
  return !!w && typeof w === 'object'
    && typeof w.current?.temperature_2m === 'number'
    && typeof w.current?.weather_code === 'number'
    && Array.isArray(w.daily?.time) && w.daily.time.length >= 5
    && Array.isArray(w.daily?.weather_code)
    && Array.isArray(w.daily?.temperature_2m_max)
    && Array.isArray(w.daily?.temperature_2m_min);
}

/** RSS links are untrusted: only plain web URLs may become hrefs (blocks javascript:/data:). */
export function safeHref(link: string): string | null {
  try {
    const u = new URL(link.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function renderWeather(container: HTMLElement, data: WeatherData): void {
  const { current, daily } = data;
  const currentTemp = Math.round(current.temperature_2m);
  const condition = getWeatherCondition(current.weather_code);
  
  const forecastDays = daily.time.slice(1, 5).map((time, i) => {
    const idx = i + 1;
    const date = formatIsoDate(time, { weekday: 'short' });
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
    
    const filteredItems = items?.filter(i => isValidItem(i) && safeHref(i.link) !== null) ?? [];
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

export function renderList(container: HTMLElement, items: NewsItem[], type: 'news' | 'events', city: string): void {
  container.setAttribute('aria-busy', 'false');
  const ul = document.createElement('ul');
  ul.className = 'widget-list';
  ul.setAttribute('role', 'list');

  for (const item of items) {
    const href = safeHref(item.link);
    if (href === null) continue;
    const li = document.createElement('li');
    li.className = 'widget-list-item';

    const div = document.createElement('div');
    div.className = 'widget-text-content';

    const a = document.createElement('a');
    a.setAttribute('href', href);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
    a.className = 'widget-link';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'widget-link-title';
    titleSpan.textContent = cleanTitle(item.title);

    const metaSpan = document.createElement('span');
    metaSpan.className = 'widget-meta';

    const sourceSpan = document.createElement('span');
    sourceSpan.textContent = item.source;

    const time = document.createElement('time');
    time.setAttribute('datetime', item.pubDate);
    time.textContent = formatDate(item.pubDate);

    metaSpan.appendChild(sourceSpan);
    metaSpan.appendChild(time);
    a.appendChild(titleSpan);
    a.appendChild(metaSpan);
    div.appendChild(a);
    li.appendChild(div);

    if (type === 'events') {
      const calUrl = createCalendarUrl(cleanTitle(item.title), href, `${city}, Japan`);
      const calA = document.createElement('a');
      calA.setAttribute('href', calUrl);
      calA.setAttribute('target', '_blank');
      calA.setAttribute('rel', 'noopener');
      calA.className = 'calendar-btn';
      calA.setAttribute('title', 'Add to calendar');
      calA.setAttribute('aria-label', `Add ${cleanTitle(item.title)} to calendar`);
      // SVG is a hardcoded literal — not RSS data — safe to use innerHTML here
      calA.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>`;
      li.appendChild(calA);
    }

    ul.appendChild(li);
  }

  container.innerHTML = '';  // clear previous — safe: no user data
  container.appendChild(ul);
}

function renderEmptyState(container: HTMLElement, type: 'news' | 'events'): void {
  container.setAttribute('aria-busy', 'false');
  container.innerHTML = `<p class="widget-empty" role="status">No recent ${type === 'news' ? 'news' : 'events'} found.</p>`;
}

function renderError(container: HTMLElement, message: string): void {
  container.setAttribute('aria-busy', 'false');
  container.innerHTML = `<p class="widget-empty widget-error" role="alert">${message}</p>`;
}
