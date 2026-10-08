/**
 * Pure helpers behind the "view a saved trip" pages (trip.html and the dashboard cards).
 *
 * A saved trip is shown the way the demo is: an overview (numbered cities joined by a dashed
 * route, a card per city) and a per-city view. Everything here is DOM-free so it can be unit
 * tested: summary numbers, trip phase/countdown, the overview stops and the page URLs.
 */

import type { ApiDestination, ApiTrip } from '@/types';
import { toCoords } from './tripAdapter';
import { daysBetween, formatIsoDate, isIsoDate, toIsoDate } from './dates';

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const dayMonth = (iso: string, locale: string): string =>
  formatIsoDate(iso, { day: 'numeric', month: 'short' }, locale);
const fullDate = (iso: string): string =>
  formatIsoDate(iso, { day: 'numeric', month: 'short', year: 'numeric' }, 'en-GB');

/** "22 Feb 2027 – 1 Mar 2027"; one date when only one is known; '' when neither is valid. */
export function formatRange(start: string | null | undefined, end: string | null | undefined): string {
  const s = isIsoDate(start) ? start : null;
  const e = isIsoDate(end) ? end : null;
  if (s && e) return s === e ? fullDate(s) : `${fullDate(s)} – ${fullDate(e)}`;
  if (s) return `From ${fullDate(s)}`;
  if (e) return `Until ${fullDate(e)}`;
  return '';
}

/**
 * Compact range for the city cards, as in the demo: "2–3 Mar" within a month,
 * "22 Feb – 1 Mar" across months, "" when no valid date.
 */
export function formatShortRange(start: string | null | undefined, end: string | null | undefined): string {
  const s = isIsoDate(start) ? start : null;
  const e = isIsoDate(end) ? end : null;
  if (!s && !e) return '';
  if (s && e && s !== e) {
    const sameMonth = s.slice(0, 7) === e.slice(0, 7);
    if (sameMonth) {
      return `${formatIsoDate(s, { day: 'numeric' }, 'en-GB')}–${dayMonth(e, 'en-GB')}`;
    }
    return `${dayMonth(s, 'en-GB')} – ${dayMonth(e, 'en-GB')}`;
  }
  return dayMonth((s ?? e)!, 'en-GB');
}

/**
 * The trip's own dates, else the span of its destinations' dates. A trip with a start but no end
 * counts as a one-day trip for phase purposes.
 */
export function tripDateSpan(trip: ApiTrip): { start: string | null; end: string | null } {
  const dests = trip.destinations ?? [];
  const starts = dests.map((d) => d.start_date).filter(isIsoDate).sort();
  const ends = dests.map((d) => d.end_date).filter(isIsoDate).sort();
  const start = isIsoDate(trip.start_date) ? trip.start_date : (starts[0] ?? ends[0] ?? null);
  const end = isIsoDate(trip.end_date) ? trip.end_date : (ends[ends.length - 1] ?? starts[starts.length - 1] ?? null);
  return { start, end };
}

// ---------------------------------------------------------------------------
// Summary: counts, phase, countdown, progress
// ---------------------------------------------------------------------------

export type TripPhase = 'undated' | 'upcoming' | 'active' | 'past';

export interface TripSummary {
  cityCount: number;
  /** Trip length in calendar days when dated, else the number of day records saved. */
  dayCount: number;
  /** Places (activities) across the whole trip. */
  placeCount: number;
  dateRange: string;
  phase: TripPhase;
  /** Calendar days until the start (upcoming only). */
  daysUntil: number | null;
  /** 1-based day of the trip (active only). */
  dayNumber: number | null;
  /** Elapsed share of the trip, 0-100 (null when undated). */
  progress: number | null;
  /** Short label for a badge/chip: "In 12 days", "Day 3 of 8", "Completed", "No dates yet". */
  phaseLabel: string;
}

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

export function summarizeTrip(trip: ApiTrip, now: Date = new Date()): TripSummary {
  const dests = trip.destinations ?? [];
  const placeCount = dests.reduce(
    (sum, d) => sum + (d.days ?? []).reduce((s, day) => s + (day.activities?.length ?? 0), 0),
    0,
  );
  const savedDays = dests.reduce((sum, d) => sum + (d.days?.length ?? 0), 0);
  const { start, end } = tripDateSpan(trip);
  const effectiveEnd = end && start && end >= start ? end : start;
  const length = start && effectiveEnd ? (daysBetween(start, effectiveEnd) ?? 0) + 1 : 0;

  const base = {
    cityCount: dests.length,
    dayCount: length > 0 ? length : savedDays,
    placeCount,
    dateRange: formatRange(trip.start_date ?? start, trip.end_date ?? end),
  };

  if (!start || !effectiveEnd) {
    return { ...base, phase: 'undated', daysUntil: null, dayNumber: null, progress: null, phaseLabel: 'No dates yet' };
  }

  const today = toIsoDate(now);
  const untilStart = daysBetween(today, start) ?? 0;
  if (untilStart > 0) {
    return {
      ...base,
      phase: 'upcoming',
      daysUntil: untilStart,
      dayNumber: null,
      progress: 0,
      phaseLabel: untilStart === 1 ? 'Tomorrow' : `In ${plural(untilStart, 'day')}`,
    };
  }
  const sinceEnd = daysBetween(effectiveEnd, today) ?? 0;
  if (sinceEnd > 0) {
    return { ...base, phase: 'past', daysUntil: null, dayNumber: null, progress: 100, phaseLabel: 'Completed' };
  }
  const dayNumber = -untilStart + 1;
  return {
    ...base,
    phase: 'active',
    daysUntil: null,
    dayNumber,
    progress: Math.min(100, Math.round((dayNumber / length) * 100)),
    phaseLabel: `Day ${dayNumber} of ${length}`,
  };
}

/** "3 cities · 8 days · 12 places" for the header and the dashboard cards. */
export function describeCounts(s: Pick<TripSummary, 'cityCount' | 'dayCount' | 'placeCount'>): string[] {
  const cities = s.cityCount === 1 ? '1 city' : `${s.cityCount} cities`;
  return [cities, plural(s.dayCount, 'day'), plural(s.placeCount, 'place')];
}

// ---------------------------------------------------------------------------
// Dashboard grouping
// ---------------------------------------------------------------------------

export interface TripGroup {
  key: TripPhase;
  title: string;
  trips: ApiTrip[];
}

const GROUP_TITLES: Record<TripPhase, string> = {
  active: 'In progress',
  upcoming: 'Upcoming',
  undated: 'No dates yet',
  past: 'Past trips',
};
const GROUP_ORDER: TripPhase[] = ['active', 'upcoming', 'undated', 'past'];

/**
 * Dashboard order: what is happening now, then what is next (soonest first), then trips still
 * without dates, then past trips (most recent first). Empty groups are dropped.
 */
export function groupTrips(trips: ApiTrip[], now: Date = new Date()): TripGroup[] {
  const buckets = new Map<TripPhase, Array<{ trip: ApiTrip; start: string; end: string }>>();
  for (const trip of trips) {
    const phase = summarizeTrip(trip, now).phase;
    const span = tripDateSpan(trip);
    const list = buckets.get(phase) ?? [];
    list.push({ trip, start: span.start ?? '', end: span.end ?? span.start ?? '' });
    buckets.set(phase, list);
  }
  return GROUP_ORDER.filter((key) => buckets.has(key)).map((key) => {
    const items = buckets.get(key)!;
    if (key === 'past') items.sort((a, b) => b.end.localeCompare(a.end));
    else if (key !== 'undated') items.sort((a, b) => a.start.localeCompare(b.start));
    return { key, title: GROUP_TITLES[key], trips: items.map((i) => i.trip) };
  });
}

// ---------------------------------------------------------------------------
// Overview stops (the numbered cities of the trip)
// ---------------------------------------------------------------------------

/** Same palette as the demo overview (src/modules/overviewMap.ts). */
export const STOP_PALETTE = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#5ac8fa', '#007aff', '#af52de', '#ff2d55'];

export interface TripStop {
  /** Destination id, stringified (stable even when a city repeats). */
  key: string;
  /** 0-based position in visiting order; also the `destIndex` of its page. */
  index: number;
  /** 1-based marker number. */
  number: number;
  name: string;
  /** Unique human label: the second Tokyo stay is "Tokyo (return)". */
  label: string;
  dates: string;
  /** null when neither the destination, its hotel nor any activity has usable coordinates. */
  coords: [number, number] | null;
  color: string;
  dayCount: number;
  placeCount: number;
}

/** Best pin for a destination: its own coordinates, else its hotel, else its first located activity. */
export function destinationCoords(dest: ApiDestination): [number, number] | null {
  const own = toCoords(dest.lat, dest.lng);
  if (own) return own;
  const hotel = dest.hotel ? toCoords(dest.hotel.lat, dest.hotel.lng) : undefined;
  if (hotel) return hotel;
  for (const day of dest.days ?? []) {
    for (const a of day.activities ?? []) {
      const c = toCoords(a.lat, a.lng);
      if (c) return c;
    }
  }
  return null;
}

function ordinalVisit(visit: number): string {
  return visit === 2 ? 'return' : `visit ${visit}`;
}

export function buildTripStops(trip: ApiTrip): TripStop[] {
  const seen = new Map<string, number>();
  return (trip.destinations ?? [])
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map((dest, index) => {
      const name = dest.city_name?.trim() || `Stop ${index + 1}`;
      const visits = (seen.get(name) ?? 0) + 1;
      seen.set(name, visits);
      return {
        key: String(dest.id),
        index,
        number: index + 1,
        name,
        label: visits > 1 ? `${name} (${ordinalVisit(visits)})` : name,
        dates: formatShortRange(dest.start_date, dest.end_date),
        coords: destinationCoords(dest),
        color: STOP_PALETTE[index % STOP_PALETTE.length]!,
        dayCount: dest.days?.length ?? 0,
        placeCount: (dest.days ?? []).reduce((s, d) => s + (d.activities?.length ?? 0), 0),
      };
    });
}

// ---------------------------------------------------------------------------
// URLs: trip.html?tripId=…|slug=… [&destIndex=n]
// ---------------------------------------------------------------------------

export interface TripRef {
  tripId?: string | null;
  slug?: string | null;
}

/** Link to the trip overview (no destIndex) or to one city (0-based). Relative, so the base path is kept. */
export function tripHref(ref: TripRef, destIndex?: number | null): string {
  const params = new URLSearchParams();
  if (ref.slug) params.set('slug', ref.slug);
  else if (ref.tripId) params.set('tripId', ref.tripId);
  if (destIndex !== undefined && destIndex !== null) params.set('destIndex', String(destIndex));
  return `trip.html?${params.toString()}`;
}

export interface TripLocation extends TripRef {
  /** null = the overview. */
  destIndex: number | null;
}

export function parseTripLocation(search: string): TripLocation {
  const params = new URLSearchParams(search);
  const raw = params.get('destIndex');
  const parsed = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  return { tripId: params.get('tripId'), slug: params.get('slug'), destIndex: parsed };
}

/** A requested city index that does not exist falls back to the overview. */
export function resolveDestIndex(requested: number | null, stopCount: number): number | null {
  return requested !== null && requested < stopCount ? requested : null;
}

// ---------------------------------------------------------------------------
// Load failures
// ---------------------------------------------------------------------------

export interface TripProblem {
  kind: 'not-found' | 'forbidden' | 'session' | 'unavailable';
  title: string;
  message: string;
  /** True when trying again can help (network / server trouble), false for a definite answer. */
  retryable: boolean;
}

const statusOf = (err: unknown): number | null => {
  if (typeof err !== 'object' || err === null) return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
};

/**
 * What to tell the user when a trip could not be loaded. A definite "no" (404/403) is not
 * retryable and never mentions the network; anything else (offline, timeout, 5xx) is.
 * `mode` is where the request came from: the owner's `?tripId=` or a shared `?slug=` link.
 */
export function describeTripError(err: unknown, mode: 'owner' | 'public'): TripProblem {
  const status = statusOf(err);
  if (status === 401) {
    return { kind: 'session', title: 'Session expired', message: 'Redirecting you to sign in again…', retryable: false };
  }
  if (mode === 'public' && (status === 404 || status === 400)) {
    return {
      kind: 'not-found',
      title: 'Shared trip not available',
      message: 'This link is not valid, or the owner has stopped sharing the trip.',
      retryable: false,
    };
  }
  if (mode === 'owner' && status === 404) {
    return {
      kind: 'not-found',
      title: 'Trip not found',
      message: "This trip doesn't exist, or you don't have access to it. Ask the owner for the public link.",
      retryable: false,
    };
  }
  if (status === 403) {
    return {
      kind: 'forbidden',
      title: 'No access to this trip',
      message: "You don't have access to this trip. Ask the owner for the public link.",
      retryable: false,
    };
  }
  return {
    kind: 'unavailable',
    title: "Couldn't load the trip",
    message: 'The server did not answer as expected. Check your connection and try again.',
    retryable: true,
  };
}
