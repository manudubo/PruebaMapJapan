import { ITINERARY } from '@/data/itinerary';

// ============================================
// Types
// ============================================

export interface SearchResult {
  type: 'activity' | 'city' | 'day' | 'hotel';
  title: string;
  subtitle: string;
  city: string;
  cityKey: string;
  date?: string;
  color?: string;
  coords?: [number, number];
  url: string;
}

// ============================================
// Search Index
// ============================================

let searchIndex: SearchResult[] = [];

/**
 * Build search index from itinerary data
 */
export function buildSearchIndex(): void {
  searchIndex = [];
  
  Object.entries(ITINERARY).forEach(([cityKey, cityData]) => {
    // Add city
    searchIndex.push({
      type: 'city',
      title: cityData.name,
      subtitle: cityData.dates,
      city: cityData.name,
      cityKey,
      url: `${cityKey}.html`
    });
    
    // Add hotel
    const hotelUrl = buildUrl(cityKey, undefined, cityData.hotel.coords);
    searchIndex.push({
      type: 'hotel',
      title: cityData.hotel.name,
      subtitle: `Hotel en ${cityData.name}`,
      city: cityData.name,
      cityKey,
      coords: cityData.hotel.coords,
      url: hotelUrl
    });
    
    // Add days and activities
    Object.entries(cityData.days).forEach(([dateKey, day]) => {
      // Add day
      const dayUrl = buildUrl(cityKey, dateKey);
      searchIndex.push({
        type: 'day',
        title: `${day.label} - ${cityData.name}`,
        subtitle: formatDateLabel(dateKey),
        city: cityData.name,
        cityKey,
        date: dateKey,
        color: day.color,
        url: dayUrl
      });
      
      // Add activities
      day.activities.forEach(activity => {
        if (activity.isGeneric) return; // Skip generic activities
        
        const activityUrl = buildUrl(cityKey, dateKey, activity.coords);
        searchIndex.push({
          type: 'activity',
          title: activity.name,
          subtitle: activity.notes || `${day.label} · ${cityData.name}`,
          city: cityData.name,
          cityKey,
          date: dateKey,
          color: day.color,
          coords: activity.coords,
          url: activityUrl
        });
      });
    });
  });
}

/**
 * Build URL with optional day and coords params
 */
function buildUrl(cityKey: string, date?: string, coords?: [number, number]): string {
  const params = new URLSearchParams();
  
  if (date) {
    params.set('day', date);
  }
  
  if (coords) {
    params.set('focus', `${coords[0]},${coords[1]}`);
  }
  
  const queryString = params.toString();
  return queryString ? `${cityKey}.html?${queryString}` : `${cityKey}.html`;
}

/**
 * Format date key to readable label
 */
function formatDateLabel(dateKey: string): string {
  const date = new Date(dateKey);
  return date.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}

// ============================================
// Search Functions
// ============================================

/**
 * Search the index
 * @param query - Search query
 * @param limit - Max results
 * @returns Matching results
 */
export function search(query: string, limit = 8): SearchResult[] {
  if (!query.trim()) return [];
  
  const normalizedQuery = normalizeText(query);
  const terms = normalizedQuery.split(/\s+/).filter(t => t.length > 1);
  
  if (terms.length === 0) return [];
  
  // Score and filter results
  const scored = searchIndex
    .map(item => ({
      item,
      score: calculateScore(item, terms, normalizedQuery)
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => item);
  
  return scored;
}

/**
 * Normalize text for search
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .trim();
}

/**
 * Calculate match score for a result
 */
function calculateScore(item: SearchResult, terms: string[], fullQuery: string): number {
  const titleNorm = normalizeText(item.title);
  const subtitleNorm = normalizeText(item.subtitle);
  const cityNorm = normalizeText(item.city);
  
  let score = 0;
  
  // Exact title match (highest priority)
  if (titleNorm === fullQuery) {
    score += 100;
  }
  
  // Title starts with query
  if (titleNorm.startsWith(fullQuery)) {
    score += 50;
  }
  
  // Title contains full query
  if (titleNorm.includes(fullQuery)) {
    score += 30;
  }
  
  // Check each term
  terms.forEach(term => {
    if (titleNorm.includes(term)) {
      score += 20;
      if (titleNorm.startsWith(term)) score += 10;
    }
    if (subtitleNorm.includes(term)) {
      score += 10;
    }
    if (cityNorm.includes(term)) {
      score += 5;
    }
  });
  
  // Boost by type (cities and activities first)
  const typeBoost: Record<string, number> = {
    city: 5,
    activity: 3,
    day: 2,
    hotel: 1
  };
  score += typeBoost[item.type] || 0;
  
  return score;
}

/**
 * Get search suggestions (popular/recent)
 */
export function getSuggestions(): SearchResult[] {
  // Return cities as default suggestions
  return searchIndex
    .filter(item => item.type === 'city')
    .slice(0, 8);
}

/**
 * Get type icon
 */
export function getTypeIcon(type: SearchResult['type']): string {
  const icons: Record<string, string> = {
    city: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1"/>
      <path d="M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16"/>
    </svg>`,
    activity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>`,
    day: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>`,
    hotel: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M3 21V7a2 2 0 012-2h14a2 2 0 012 2v14"/>
      <path d="M9 21V10h6v11"/>
      <path d="M3 21h18"/>
    </svg>`
  };
  return icons[type] || icons.activity;
}
