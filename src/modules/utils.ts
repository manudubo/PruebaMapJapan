// Utility Functions & Helpers

const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

const BLACKLIST_DOMAINS = [
  'tripadvisor', 'viator', 'booking.com', 'agoda', 'airbnb', 
  'expedia', 'klook', 'getyourguide', 'yelp', 'foursquare',
  'pinterest', 'tiktok.com', 'youtube.com', 'facebook.com'
];

const BLACKLIST_TERMS = [
  'top 10', 'best hotels', 'cheap flights', 'airbnb', 
  'weather forecast', 'extended forecast', 'things to do'
];

export function getCache<T>(key: string): T | null {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_DURATION) {
      localStorage.removeItem(key);
      return null;
    }
    return data as T;
  } catch (e) {
    return null;
  }
}

export function setCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({
      data,
      timestamp: Date.now()
    }));
  } catch (e) {
    console.warn('Cache full', e);
  }
}

export function createElement(tag: string, className?: string, html: string = ''): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (html) el.innerHTML = html;
  return el;
}

export function announceToScreenReader(message: string): void {
  const ariaLive = document.getElementById('aria-live-region') || createElement('div', 'sr-only');
  if (!ariaLive.id) {
    ariaLive.id = 'aria-live-region';
    ariaLive.setAttribute('aria-live', 'polite');
    document.body.appendChild(ariaLive);
  }
  ariaLive.textContent = message;
}

export function createDirectionsUrl(coords: [number, number]): string {
  const [lat, lng] = coords;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=transit`;
}

export function createCalendarUrl(title: string, location: string, details: string): string {
  return `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;
}

export function cleanTitle(title: string): string {
  let clean = title.split(' - ')[0].split(' | ')[0];
  clean = clean.replace(/^\d{1,2}\/\d{1,2}\/\d{4}/, '').trim();
  return clean;
}

export function isValidItem(item: { title: string, link: string }, city: string): boolean {
  const title = item.title.toLowerCase();
  const link = item.link.toLowerCase();
  
  if (BLACKLIST_DOMAINS.some(domain => link.includes(domain))) return false;
  if (BLACKLIST_TERMS.some(term => title.includes(term))) return false;

  return true;
}

export function formatDate(dateString: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [y, m, d] = dateString.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
  }

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'Fecha: N/A';
  
  return date.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
}