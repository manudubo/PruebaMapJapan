import type { CacheEntry, NewsItem } from '@/types';

export const CACHE_DURATION = 15 * 60 * 1000;

export const BLACKLIST_DOMAINS = new Set([
  'tripadvisor', 'viator', 'booking.com', 'agoda', 'airbnb',
  'expedia', 'klook', 'getyourguide', 'yelp', 'foursquare',
  'pinterest', 'tiktok.com', 'youtube.com', 'facebook.com'
]);

export const BLACKLIST_TERMS = new Set([
  'top 10', 'best hotels', 'cheap flights', 'airbnb',
  'weather forecast', 'extended forecast', 'things to do'
]);

export function getCache<T>(key: string): T | null {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached) as CacheEntry<T>;
    if (Date.now() - timestamp > CACHE_DURATION) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function setCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch (e) {
    console.warn('Cache storage error:', (e as Error).message);
  }
}

export function clearCache(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch { /* ignore */ }
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K, className = '', html = ''
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (html) el.innerHTML = html;
  return el;
}

export function cleanTitle(title: string): string {
  return title.split(' - ')[0].split(' | ')[0].trim();
}

export function formatDate(dateString: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

export function isValidItem(item: NewsItem): boolean {
  const title = item.title.toLowerCase();
  const link = item.link.toLowerCase();
  for (const domain of BLACKLIST_DOMAINS) {
    if (link.includes(domain)) return false;
  }
  for (const term of BLACKLIST_TERMS) {
    if (title.includes(term)) return false;
  }
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => any>(
  func: T, wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return function executedFunction(...args: Parameters<T>) {
    const later = () => { timeout = null; func(...args); };
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function throttle<T extends (...args: any[]) => any>(
  func: T, limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => { inThrottle = false; }, limit);
    }
  };
}

export function createCalendarUrl(title: string, link: string, location: string): string {
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, details: link, location });
  return `https://www.google.com/calendar/render?${params}`;
}

export function createDirectionsUrl(coords: [number, number]): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coords[0]},${coords[1]}&travelmode=transit`;
}

export function announceToScreenReader(message: string): void {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.className = 'sr-only';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
