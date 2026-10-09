/**
 * Pure model helpers for the trip editor: types with client-side keys, place
 * parsing, date/day chips, ordering, validation and the numbered route stops.
 * No DOM, no network — everything here is unit-tested (tests/trip-edit-model.test.ts).
 */

import type { ApiActivity, ApiDay, ApiDestination, ApiHotel, ApiTrip } from '@/types';
import { addDays, daysBetween, formatIsoDate, isIsoDate } from '@/modules/dates';
import { safeHttpUrl, toCoords } from '@/modules/tripAdapter';

// ---------------------------------------------------------------------------
// Editor entity types
//
// Server ids are numbers at runtime but typed string; the editor stringifies
// them all and keeps a client-only `_key` that never changes, so the DOM can be
// reconciled by key even when a temporary id is replaced by the server's.
// ---------------------------------------------------------------------------

export type EActivity = ApiActivity & { _key: string };
export type EDay = Omit<ApiDay, 'activities'> & { _key: string; activities: EActivity[] };
export type EHotel = ApiHotel & { _key: string };
export type EDest = Omit<ApiDestination, 'days' | 'hotel'> & { _key: string; days: EDay[]; hotel?: EHotel | null };
export type ETrip = Omit<ApiTrip, 'destinations'> & { destinations: EDest[] };

let keyCounter = 0;
/** A client-only, never reused key. */
export function newKey(prefix = 'k'): string {
  keyCounter += 1;
  return `${prefix}${keyCounter}`;
}

/** Temporary ids (rows created locally, not yet confirmed by the API). */
export const TEMP_PREFIX = 'tmp-';
export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_PREFIX);
}
let tempCounter = 0;
export function newTempId(): string {
  tempCounter += 1;
  return `${TEMP_PREFIX}${tempCounter}`;
}

const str = (v: unknown): string => String(v);

export function normalizeActivity(a: ApiActivity): EActivity {
  return { ...a, id: str(a.id), _key: newKey('a') };
}

export function normalizeDay(d: ApiDay): EDay {
  return { ...d, id: str(d.id), _key: newKey('d'), activities: (d.activities ?? []).map(normalizeActivity) };
}

export function normalizeDestination(d: ApiDestination): EDest {
  return {
    ...d,
    id: str(d.id),
    trip_id: str(d.trip_id),
    _key: newKey('c'),
    days: (d.days ?? []).map(normalizeDay),
    hotel: d.hotel ? { ...d.hotel, id: str(d.hotel.id), _key: newKey('h') } : null,
  };
}

/** Stringify ids, attach client keys, order everything the way the views do. */
export function normalizeTrip(t: ApiTrip): ETrip {
  const destinations = (t.destinations ?? []).map(normalizeDestination);
  destinations.sort((a, b) => a.order_index - b.order_index);
  for (const d of destinations) {
    d.days.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.order_index - b.order_index);
    for (const day of d.days) day.activities.sort((a, b) => a.order_index - b.order_index);
  }
  return { ...t, id: str(t.id), user_id: str(t.user_id), destinations };
}

// ---------------------------------------------------------------------------
// Places (geocoder results)
// ---------------------------------------------------------------------------

export interface Place {
  name: string;
  country: string;
  lat: number;
  lng: number;
  /** Full label as the geocoder returned it. */
  label: string;
}

export interface GeocoderHit {
  lat: string;
  lon: string;
  display_name: string;
}

/**
 * "Kyoto, Kyoto Prefecture, Japan" -> { name: "Kyoto", country: "Japan" }.
 * Nominatim puts the most specific part first and the country last; a single
 * part has no country. Everything is trimmed and length-capped to the API's
 * limits (255 / 100).
 */
export function parsePlaceLabel(label: string): { name: string; country: string } {
  const parts = label.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { name: '', country: '' };
  const name = parts[0]!.slice(0, 255);
  const country = parts.length > 1 ? parts[parts.length - 1]!.slice(0, 100) : '';
  return { name, country };
}

/** A geocoder hit as a Place, or null when its coordinates are unusable. */
export function hitToPlace(hit: GeocoderHit): Place | null {
  const coords = toCoords(hit.lat, hit.lon);
  if (!coords) return null;
  const { name, country } = parsePlaceLabel(hit.display_name);
  if (!name) return null;
  return { name, country, lat: coords[0], lng: coords[1], label: hit.display_name };
}

/** Round to 6 decimals (≈ 0.1 m): what the API stores is plenty and URLs stay short. */
export function roundCoord(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Google Maps "search this point" link — the one-click `maps_url` for an activity. */
export function googleMapsPointUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${roundCoord(lat)}%2C${roundCoord(lng)}`;
}

/**
 * A readable name for a pasted Google Maps link: the `/maps/place/<Name>/…`
 * segment when there is one ("Kinkaku-ji"), otherwise a neutral fallback.
 */
export function placeNameFromMapsUrl(url: string, fallback = 'Pinned place'): string {
  const m = /\/maps\/place\/([^/@?]+)/.exec(url);
  if (!m) return fallback;
  try {
    const name = decodeURIComponent(m[1]!.replace(/\+/g, ' ')).trim().slice(0, LIMITS.activityName);
    return name || fallback;
  } catch {
    return fallback;
  }
}

/** Country for a hit that has none: the one used most by the trip's destinations. */
export function dominantCountry(destinations: Array<{ country: string }>): string {
  const counts = new Map<string, number>();
  for (const d of destinations) if (d.country) counts.set(d.country, (counts.get(d.country) ?? 0) + 1);
  let best = '';
  let bestN = 0;
  for (const [c, n] of counts) if (n > bestN) { best = c; bestN = n; }
  return best;
}

// ---------------------------------------------------------------------------
// Dates and day chips
// ---------------------------------------------------------------------------

/** Day chips never expand past this many dates (a typo'd year must not render thousands). */
export const MAX_CHIP_DAYS = 90;

/** Marker palette shared with the demo; one colour per day, cycling. */
export const DAY_COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#5ac8fa', '#007aff', '#af52de', '#ff2d55'];
/** Accessible names of the palette, in the same order (the day-colour picker). */
export const DAY_COLOR_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Sky blue', 'Blue', 'Purple', 'Pink'] as const;
export function dayColor(index: number): string {
  return DAY_COLORS[((index % DAY_COLORS.length) + DAY_COLORS.length) % DAY_COLORS.length]!;
}

/** "Sun 22 Feb" for chips; '' for an invalid date. */
export function chipLabel(iso: string): string {
  const wd = formatIsoDate(iso, { weekday: 'short' }, 'en-GB');
  const d = formatIsoDate(iso, { day: 'numeric' }, 'en-GB');
  const m = formatIsoDate(iso, { month: 'short' }, 'en-GB');
  return wd && d ? `${wd} ${d} ${m}` : iso;
}

export interface DayChip {
  /** ISO date, or '' for a day without a date. */
  date: string;
  /** Position in the city (1-based) — "Day 3". */
  number: number;
  label: string;
  color: string;
  dayId: string | null;
  activityCount: number;
  /** The date lies outside the destination's own range. */
  outOfRange: boolean;
}

/**
 * The day chips of a destination: every date of its range (existing day rows
 * or still-virtual ones that are created on first use) plus any stored day
 * outside the range, in calendar order. Capped at MAX_CHIP_DAYS range dates.
 * Colours follow the chip position, like the demo's one-colour-per-day.
 */
export function dayChips(dest: Pick<EDest, 'start_date' | 'end_date' | 'days'>): DayChip[] {
  const byDate = new Map<string, EDay>();
  for (const day of dest.days) if (!byDate.has(day.date)) byDate.set(day.date, day);

  let range: string[] = [];
  if (dest.start_date && dest.end_date && isIsoDate(dest.start_date) && isIsoDate(dest.end_date)) {
    const span = daysBetween(dest.start_date, dest.end_date);
    if (span !== null && span >= 0) {
      const n = Math.min(span + 1, MAX_CHIP_DAYS);
      range = Array.from({ length: n }, (_, i) => addDays(dest.start_date!, i)!);
    }
  } else if (dest.start_date && isIsoDate(dest.start_date)) {
    range = [dest.start_date];
  }
  const inRange = new Set(range);
  const dates = [...new Set([...range, ...byDate.keys()])].filter((d) => d !== '');
  dates.sort();

  const chips = dates.map<DayChip>((date, i) => {
    const day = byDate.get(date) ?? null;
    return {
      date,
      number: i + 1,
      label: day?.label?.trim() || chipLabel(date),
      color: day?.color_hex || dayColor(i),
      dayId: day?.id ?? null,
      activityCount: day?.activities.length ?? 0,
      outOfRange: !inRange.has(date),
    };
  });
  return chips;
}

/**
 * Dates for a destination added after the existing ones: starts the day the
 * previous one ends (you check out and move on the same day) and lasts
 * `nights`, never past the trip's end. Null parts when the trip has no dates.
 */
export function suggestDestinationDates(
  trip: Pick<ETrip, 'start_date' | 'end_date'>,
  existing: Array<Pick<EDest, 'start_date' | 'end_date'>>,
  nights = 2,
): { start_date: string | null; end_date: string | null } {
  let start: string | null = null;
  for (let i = existing.length - 1; i >= 0; i--) {
    const e = existing[i]!;
    if (e.end_date ?? e.start_date) { start = (e.end_date ?? e.start_date)!; break; }
  }
  start = start ?? trip.start_date;
  if (!start || !isIsoDate(start)) return { start_date: null, end_date: null };
  let end = addDays(start, nights);
  if (trip.end_date && end && end > trip.end_date) end = trip.end_date >= start ? trip.end_date : start;
  return { start_date: start, end_date: end };
}

/** "22 Feb – 1 Mar" (no year), "22 Feb", or '' — the demo's short date range. */
export function shortRange(start: string | null, end: string | null): string {
  const f = (iso: string): string => formatIsoDate(iso, { day: 'numeric', month: 'short' }, 'en-GB');
  if (start && end && start !== end) return `${f(start)} – ${f(end)}`;
  const one = start ?? end;
  return one ? f(one) : '';
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/** order_index for a new row appended to `items`. */
export function nextOrderIndex(items: Array<{ order_index: number }>): number {
  return items.reduce((max, i) => Math.max(max, i.order_index), -1) + 1;
}

/** A copy of `items` with element `from` moved to `to` (both clamped); same array when nothing moves. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return items;
  const target = Math.max(0, Math.min(items.length - 1, to));
  if (target === from) return items;
  const copy = items.slice();
  const [moved] = copy.splice(from, 1);
  copy.splice(target, 0, moved!);
  return copy;
}

/** Re-number order_index 0..n-1 following array order (returns copies). */
export function renumber<T extends { order_index: number }>(items: T[]): T[] {
  return items.map((it, i) => (it.order_index === i ? it : { ...it, order_index: i }));
}

// ---------------------------------------------------------------------------
// Validation (client-side mirror of backend/src/validation/schemas.ts)
// ---------------------------------------------------------------------------

export const LIMITS = { tripName: 255, city: 255, country: 100, activityName: 255, hotelName: 255 } as const;

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export function validateTripFields(f: { name: string; start_date: string | null; end_date: string | null }): FieldErrors<'name' | 'start_date' | 'end_date'> {
  const errors: FieldErrors<'name' | 'start_date' | 'end_date'> = {};
  const name = f.name.trim();
  if (!name) errors.name = 'Give your trip a name.';
  else if (name.length > LIMITS.tripName) errors.name = `Keep the name under ${LIMITS.tripName} characters.`;
  if (f.start_date && !isIsoDate(f.start_date)) errors.start_date = 'Enter a valid start date.';
  if (f.end_date && !isIsoDate(f.end_date)) errors.end_date = 'Enter a valid end date.';
  if (!errors.start_date && !errors.end_date && f.start_date && f.end_date && f.start_date > f.end_date) {
    errors.end_date = 'The trip cannot end before it starts.';
  }
  return errors;
}

export function validateDestinationFields(f: {
  city_name: string; country: string; start_date: string | null; end_date: string | null;
}): FieldErrors<'city_name' | 'country' | 'start_date' | 'end_date'> {
  const errors: FieldErrors<'city_name' | 'country' | 'start_date' | 'end_date'> = {};
  if (!f.city_name.trim()) errors.city_name = 'Name this destination.';
  else if (f.city_name.trim().length > LIMITS.city) errors.city_name = `Keep it under ${LIMITS.city} characters.`;
  if (!f.country.trim()) errors.country = 'Add the country.';
  else if (f.country.trim().length > LIMITS.country) errors.country = `Keep it under ${LIMITS.country} characters.`;
  if (f.start_date && !isIsoDate(f.start_date)) errors.start_date = 'Enter a valid date.';
  if (f.end_date && !isIsoDate(f.end_date)) errors.end_date = 'Enter a valid date.';
  if (!errors.start_date && !errors.end_date && f.start_date && f.end_date && f.start_date > f.end_date) {
    errors.end_date = 'Departure must be on or after arrival.';
  }
  return errors;
}

export function validateActivityFields(f: {
  name: string; time: string | null; maps_url: string | null;
}): FieldErrors<'name' | 'time' | 'maps_url'> {
  const errors: FieldErrors<'name' | 'time' | 'maps_url'> = {};
  const name = f.name.trim();
  if (!name) errors.name = 'Name this place.';
  else if (name.length > LIMITS.activityName) errors.name = `Keep it under ${LIMITS.activityName} characters.`;
  if (f.time && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(f.time)) errors.time = 'Use a time like 09:30.';
  const url = (f.maps_url ?? '').trim();
  if (url && !safeHttpUrl(url)) errors.maps_url = 'The link must start with http:// or https://';
  return errors;
}

/** The API rejects NUL characters anywhere in a body; drop them from typed/pasted text. */
export function cleanText(s: string): string {
  return s.replace(/\u0000/g, '');
}

/** Error message for a link field that must be an absolute http(s) URL, or null when fine/empty. */
export function validateHttpUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return safeHttpUrl(v) ? null : 'The link must start with http:// or https://';
}

/** True when `errors` has no messages. */
export function isValid(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).every((m) => !m);
}

// ---------------------------------------------------------------------------
// Route stops and summaries
// ---------------------------------------------------------------------------

export interface RouteStop {
  key: string;
  destId: string;
  number: number;
  name: string;
  label: string;
  dates: string;
  coords: [number, number] | null;
  color: string;
}

/**
 * The numbered stops of the overview map (and the "Cities" cards), exactly the
 * demo's shape: number = visiting order, colour = palette cycled, the second
 * visit of a city labelled "(return)". Destinations without coordinates keep
 * their number but have `coords: null` (listed, not mapped).
 */
export function routeStops(trip: Pick<ETrip, 'destinations'>): RouteStop[] {
  const seen = new Map<string, number>();
  return trip.destinations.map((d, i) => {
    const norm = d.city_name.trim().toLowerCase();
    const visits = (seen.get(norm) ?? 0) + 1;
    seen.set(norm, visits);
    return {
      key: d._key,
      destId: d.id,
      number: i + 1,
      name: d.city_name.trim(),
      label: visits > 1 ? `${d.city_name.trim()} (return)` : d.city_name.trim(),
      dates: shortRange(d.start_date, d.end_date),
      coords: toCoords(d.lat, d.lng) ?? null,
      color: dayColor(i),
    };
  });
}

export interface TripSummary {
  cities: number;
  days: number;
  places: number;
  unlocated: number;
}

export function tripSummary(trip: Pick<ETrip, 'destinations'>): TripSummary {
  let days = 0;
  let places = 0;
  let unlocated = 0;
  for (const d of trip.destinations) {
    days += d.days.filter((x) => x.activities.length > 0).length;
    for (const day of d.days) {
      for (const a of day.activities) {
        places += 1;
        if (!a.is_generic && !toCoords(a.lat, a.lng)) unlocated += 1;
      }
    }
  }
  return { cities: trip.destinations.length, days, places, unlocated };
}

export interface ChecklistItem {
  id: 'name' | 'dates' | 'cities' | 'places' | 'located';
  done: boolean;
  text: string;
  /** Not blocking: sharing works without it. */
  optional: boolean;
}

/** "What is left before this looks like the demo": the share step's checklist. */
export function publishChecklist(trip: ETrip): ChecklistItem[] {
  const s = tripSummary(trip);
  return [
    { id: 'name', done: trip.name.trim().length > 0, text: 'Trip has a name', optional: false },
    { id: 'cities', done: s.cities > 0, text: s.cities > 0 ? `${s.cities} destination${s.cities === 1 ? '' : 's'} on the route` : 'Add at least one destination', optional: false },
    { id: 'places', done: s.places > 0, text: s.places > 0 ? `${s.places} place${s.places === 1 ? '' : 's'} planned` : 'Add a place to visit', optional: false },
    { id: 'dates', done: !!trip.start_date && !!trip.end_date, text: trip.start_date && trip.end_date ? 'Trip dates set' : 'Set the trip dates (optional)', optional: true },
    { id: 'located', done: s.unlocated === 0, text: s.unlocated === 0 ? 'Every place is on the map' : `${s.unlocated} place${s.unlocated === 1 ? '' : 's'} without a map location`, optional: true },
  ];
}
