// Utility Functions
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutos (más fresco)

// Dominios bloqueados (Spam SEO, Agencias, etc.)
const BLACKLIST_DOMAINS = [
  'tripadvisor', 'viator', 'booking.com', 'agoda', 'airbnb', 
  'expedia', 'klook', 'getyourguide', 'yelp', 'foursquare',
  'pinterest', 'tiktok.com', 'youtube.com', 'facebook.com'
];

// Términos bloqueados en títulos
const BLACKLIST_TERMS = [
  'top 10', 'best hotels', 'cheap flights', 'airbnb', 
  'weather forecast', 'extended forecast', 'things to do'
];

export function getCache(key) {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_DURATION) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch (e) { return null; }
}

export function setCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (e) { console.warn('Cache error'); }
}

export function createElement(tag, className, html = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (html) el.innerHTML = html;
  return el;
}

export function cleanTitle(title) {
  // Limpia sufijos comunes de medios
  return title.split(' - ')[0].split(' | ')[0].trim();
}

export function formatDate(dateString) {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
}

// Filtro maestro de relevancia
export function isValidItem(item, city) {
  const title = item.title.toLowerCase();
  const link = item.link.toLowerCase();
  
  // 1. Bloqueo por Dominio
  if (BLACKLIST_DOMAINS.some(d => link.includes(d))) return false;

  // 2. Bloqueo por Términos Spam
  if (BLACKLIST_TERMS.some(t => title.includes(t))) return false;

  return true;
}