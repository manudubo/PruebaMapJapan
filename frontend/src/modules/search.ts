import { ITINERARY } from '@/data/itinerary';
import type { ApiTrip } from '@/types';
import { seedUserSearchIndex, upsertUserTrip } from './userSearchIndex';
import { formatDateLabel } from './tripEntries';

export { buildTripEntries, tripUrl } from './tripEntries';
export { seedUserSearchIndex };

// ============================================
// Types
// ============================================

export interface SearchResult {
  type: 'activity' | 'city' | 'day' | 'hotel' | 'trip';
  title: string;
  subtitle: string;
  city: string;
  cityKey: string;
  date?: string;
  color?: string;
  coords?: [number, number];
  /** Where selecting the result goes, query string included (deep link). */
  url: string;
  /** User scope only: the trip this entry belongs to. */
  tripId?: string;
  /** User scope only: "City · Trip name", so a hit is placeable among several trips. */
  context?: string;
}

// ============================================
// Demo index (static itinerary)
// ============================================

let searchIndex: SearchResult[] = [];

/** `page.html` plus the day/activity parameters the city map reads to focus a place. */
function withFocus(page: string, date: string, activity: string): string {
  const params = new URLSearchParams({ day: date, activity });
  return `${page}?${params.toString()}`;
}

/** Index entries for the static demo itinerary. */
export function buildDemoEntries(): SearchResult[] {
  const out: SearchResult[] = [];

  Object.entries(ITINERARY).forEach(([cityKey, cityData]) => {
    out.push({
      type: 'city',
      title: cityData.name,
      subtitle: cityData.dates,
      city: cityData.name,
      cityKey,
      url: `${cityKey}.html`,
    });

    out.push({
      type: 'hotel',
      title: cityData.hotel.name,
      subtitle: `Hotel in ${cityData.name}`,
      city: cityData.name,
      cityKey,
      coords: cityData.hotel.coords,
      url: `${cityKey}.html`,
    });

    Object.entries(cityData.days).forEach(([dateKey, day]) => {
      out.push({
        type: 'day',
        title: `${day.label} - ${cityData.name}`,
        subtitle: formatDateLabel(dateKey),
        city: cityData.name,
        cityKey,
        date: dateKey,
        color: day.color,
        url: `${cityKey}.html`,
      });

      day.activities.forEach((activity) => {
        if (activity.isGeneric) return; // Skip generic activities
        out.push({
          type: 'activity',
          title: activity.name,
          subtitle: activity.notes || `${day.label} · ${cityData.name}`,
          city: cityData.name,
          cityKey,
          date: dateKey,
          color: day.color,
          coords: activity.coords,
          url: withFocus(`${cityKey}.html`, dateKey, activity.name),
        });
      });
    });
  });

  return out;
}

/** Build (or rebuild) the demo index. */
export function buildSearchIndex(): void {
  searchIndex = buildDemoEntries();
}

// ============================================
// User trips (API data)
// ============================================

/**
 * Hand a trip the page already loaded (e.g. the dashboard's list) to the user-trips cache,
 * so the first search does not have to fetch it again. It never touches the demo index.
 */
export function extendSearchIndexWithApiTrip(trip: ApiTrip): void {
  upsertUserTrip(trip);
}

// ============================================
// Search Functions
// ============================================

/** Longer queries are cut: nobody types 200+ characters on purpose, and scoring is O(terms × index). */
export const MAX_QUERY_LENGTH = 200;
const MAX_TERMS = 8;
/** With a current trip, this many slots stay reserved for other trips' matches. */
const OTHER_TRIPS_MIN_SLOTS = 3;

export interface SearchOptions {
  limit?: number;
  /** Rank matches inside this trip ahead of other trips'. */
  currentTripId?: string | null;
}

/**
 * Search the demo index
 * @param query - Search query
 * @param limit - Max results
 * @returns Matching results
 */
export function search(query: string, limit = 8): SearchResult[] {
  return searchEntries(searchIndex, query, { limit });
}

/** Search any entry list (demo or a user's trips). Pure: same input, same ranking. */
export function searchEntries(
  entries: readonly SearchResult[],
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  const { limit = 8, currentTripId = null } = options;
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const fullQuery = normalizeQuery(query);

  const scored = entries
    .map((item) => ({ item, score: calculateScore(item, terms, fullQuery) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);

  if (!currentTripId) return scored.slice(0, limit);

  // The trip being viewed comes first, but other trips keep a few slots so a rich current
  // trip cannot hide every other match.
  const inCurrent = scored.filter((r) => r.tripId === currentTripId);
  const elsewhere = scored.filter((r) => r.tripId !== currentTripId);
  const reserved = Math.min(elsewhere.length, OTHER_TRIPS_MIN_SLOTS, limit);
  const fromCurrent = inCurrent.slice(0, Math.max(0, limit - reserved));
  return [...fromCurrent, ...elsewhere.slice(0, limit - fromCurrent.length)];
}

/** Normalised, length-capped query: what is actually matched. */
export function normalizeQuery(query: string): string {
  return normalizeText(capQuery(query));
}

/** Cut at MAX_QUERY_LENGTH, dropping a word the cut split in two (a stray "ra" would match half the index). */
function capQuery(query: string): string {
  if (query.length <= MAX_QUERY_LENGTH) return query;
  const cut = query.slice(0, MAX_QUERY_LENGTH);
  if (/\s/.test(query.charAt(MAX_QUERY_LENGTH))) return cut;
  const lastSpace = cut.search(/\s\S*$/);
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

/**
 * Distinct search terms. One-character terms count only when they are not ASCII
 * (a single kanji is a word; a single "a" matches everything).
 */
export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const t of normalizeQuery(query).split(/\s+/)) {
    if (t.length === 0) continue;
    if (t.length === 1 && t.charCodeAt(0) < 0x80) continue;
    seen.add(t);
    if (seen.size >= MAX_TERMS) break;
  }
  return [...seen];
}

/**
 * Normalize text for search
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Remove diacritics
    .trim();
}

interface Normalized {
  title: string;
  subtitle: string;
  city: string;
}

// Entries are immutable once built, so each is normalised once, not on every keystroke.
const normalizedCache = new WeakMap<SearchResult, Normalized>();

function normalizedFields(item: SearchResult): Normalized {
  let n = normalizedCache.get(item);
  if (!n) {
    n = { title: normalizeText(item.title), subtitle: normalizeText(item.subtitle), city: normalizeText(item.city) };
    normalizedCache.set(item, n);
  }
  return n;
}

/**
 * Calculate match score for a result
 */
function calculateScore(item: SearchResult, terms: string[], fullQuery: string): number {
  const { title: titleNorm, subtitle: subtitleNorm, city: cityNorm } = normalizedFields(item);

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
  terms.forEach((term) => {
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

  // No textual match: don't let the type boost turn an unrelated item into a result.
  if (score === 0) return 0;

  // Boost by type (trips and cities first)
  const typeBoost: Record<string, number> = {
    trip: 6,
    city: 5,
    activity: 3,
    day: 2,
    hotel: 1,
  };
  score += typeBoost[item.type] || 0;

  return score;
}

/**
 * Get search suggestions for the demo (its cities).
 */
export function getSuggestions(): SearchResult[] {
  return searchIndex.filter((item) => item.type === 'city').slice(0, 8);
}

/**
 * Get type icon
 */
export function getTypeIcon(type: SearchResult['type']): string {
  const icons: Record<string, string> = {
    trip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M2 7a2 2 0 012-2h5l2 2h9a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V7z"/>
    </svg>`,
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
    </svg>`,
  };
  return icons[type] || icons.activity;
}
