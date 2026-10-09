/**
 * Trip Adapter
 *
 * Converts API response types (ApiTrip / ApiDestination / ApiDay / ApiActivity)
 * into the existing app data structures (CityData / Day / Activity) so that the
 * existing map.ts, search.ts, and widget modules work without any modifications.
 */

import type {
  ApiCoordinate,
  ApiTrip,
  ApiDestination,
  ApiDay,
  ApiActivity,
  CityData,
  Day,
  Activity,
  Hotel,
} from '@/types';
import { formatIsoDate } from './dates';

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

/** Zoom used when a destination has no stored zoom_level (DB default). */
export const DEFAULT_ZOOM = 12;
/** World view used when nothing in a destination has coordinates. */
const WORLD_CENTER: [number, number] = [20, 0];
const WORLD_ZOOM = 2;
/** Marker colour for days saved without one. */
const DEFAULT_DAY_COLOR = '#007aff';

/**
 * Convert API coordinates (numbers, NUMERIC strings or null) to a Leaflet
 * pair. Returns undefined when either value is missing, blank, non-numeric or
 * out of range — Leaflet would otherwise coerce null to 0 and drop the pin at
 * 0,0 ("Null Island").
 */
export function toCoords(lat: ApiCoordinate | undefined, lng: ApiCoordinate | undefined): [number, number] | undefined {
  const parse = (v: ApiCoordinate | undefined): number =>
    v === null || v === undefined || (typeof v === 'string' && v.trim() === '') ? NaN : Number(v);
  const la = parse(lat);
  const ln = parse(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
    return undefined;
  }
  return [la, ln];
}

/**
 * Return `url` only when it is an absolute http(s) URL. maps_url ends up as a
 * link href, so anything else (javascript:, data:, relative junk from rows
 * written before validation existed) is dropped.
 */
export function safeHttpUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Label for the n-th (0-based) optional activity of a day: A, B, … Z, then
 * 27, 28, … — mirrors the demo's "Option A / Option B" alternatives.
 */
export function optionLabel(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

/** "Sun 22" — the demo's day-label format, used when a day has no label. */
function defaultDayLabel(iso: string): string {
  const weekday = formatIsoDate(iso, { weekday: 'short' });
  const day = formatIsoDate(iso, { day: 'numeric' });
  return weekday && day ? `${weekday} ${day}` : iso;
}

// ---------------------------------------------------------------------------
// Activity adapter
// ---------------------------------------------------------------------------

/**
 * Convert an ApiActivity to the Activity view shape used by the map/legend.
 *
 * `optional` is the alternative's display label ("A", "B", …). The API only
 * stores the is_optional flag, so the label is assigned per day by
 * apiDayToDay; called on its own, an optional activity is labelled "A".
 */
export function apiActivityToActivity(activity: ApiActivity, optionalLabel = 'A'): Activity {
  const view: Activity = {
    name: activity.name,
    coords: toCoords(activity.lat, activity.lng),
    notes: activity.notes,
    optional: activity.is_optional ? optionalLabel : undefined,
    isGeneric: activity.is_generic,
  };
  if (activity.id != null) view.id = String(activity.id);
  if (activity.time) view.time = activity.time;
  const mapsUrl = safeHttpUrl(activity.maps_url);
  if (mapsUrl) view.mapsUrl = mapsUrl;
  return view;
}

// ---------------------------------------------------------------------------
// Day adapter
// ---------------------------------------------------------------------------

/**
 * Convert an ApiDay to the Day view shape used by the map/legend.
 *
 * Optional activities are labelled A, B, C… in order_index order, and
 * `hasOptions` is true when at least one activity is optional.
 */
export function apiDayToDay(day: ApiDay): Day {
  let optionalCount = 0;
  const activities = day.activities
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map((a) => apiActivityToActivity(a, a.is_optional ? optionLabel(optionalCount++) : undefined));

  return {
    label: day.label || defaultDayLabel(day.date),
    color: day.color_hex || DEFAULT_DAY_COLOR,
    hasOptions: optionalCount > 0 || undefined,
    activities,
  };
}

// ---------------------------------------------------------------------------
// Destination (CityData) adapter
// ---------------------------------------------------------------------------

/**
 * Convert an ApiDestination to the CityData view shape.
 *
 * - `dates` is built from start_date and end_date when available.
 * - `hotel` falls back to a placeholder at the destination centre when absent.
 * - `days` are keyed by ISO date (YYYY-MM-DD) in calendar order; a second day
 *   on the same date gets a `date#id` key instead of overwriting the first.
 * - `center` falls back to the hotel, then the first located activity, then a
 *   world view; `zoom` falls back to the DB default when zoom_level is null.
 */
export function apiDestinationToCityData(dest: ApiDestination): CityData {
  const destCoords = toCoords(dest.lat, dest.lng);

  const hotel: Hotel = dest.hotel
    ? { name: dest.hotel.name, coords: toCoords(dest.hotel.lat, dest.hotel.lng) }
    : { name: dest.city_name, coords: destCoords };

  const dates = buildDateRange(dest.start_date, dest.end_date);

  // Calendar order; order_index only breaks ties ("Generate all days" leaves
  // every generated day at order_index 0).
  const days: Record<string, Day> = {};
  const sortedDays = dest.days
    .slice()
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.order_index - b.order_index);
  for (const apiDay of sortedDays) {
    const base = apiDay.date ?? String(apiDay.id);
    const key = base in days ? `${base}#${apiDay.id}` : base;
    days[key] = apiDayToDay(apiDay);
  }

  const firstActivityCoords = Object.values(days)
    .flatMap((d) => d.activities)
    .find((a) => a.coords)?.coords;
  const center = destCoords ?? hotel.coords ?? firstActivityCoords;

  return {
    name: dest.city_name,
    center: center ?? WORLD_CENTER,
    zoom: center ? (dest.zoom_level ?? DEFAULT_ZOOM) : WORLD_ZOOM,
    hotel,
    dates,
    days,
  };
}

// ---------------------------------------------------------------------------
// Trip adapter
// ---------------------------------------------------------------------------

/**
 * Convert a full ApiTrip into an array of CityData entries.
 *
 * The array is ordered by destination order_index so that the legacy
 * navigation (which iterates over the Itinerary object) presents destinations
 * in trip order.
 *
 * Returns both the array and a keyed record (destinationId → CityData) so
 * callers can look up by either position or id.
 */
export function apiTripToCityData(trip: ApiTrip): CityData[] {
  return trip.destinations
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map(apiDestinationToCityData);
}

/**
 * Convert a full ApiTrip into a keyed record suitable for use as an Itinerary.
 *
 * Keys are destination ids (UUIDs). If the same city appears more than once
 * the destination id makes each entry unique.
 */
export function apiTripToItinerary(trip: ApiTrip): Record<string, CityData> {
  const record: Record<string, CityData> = {};
  const sorted = trip.destinations
    .slice()
    .sort((a, b) => a.order_index - b.order_index);
  for (const dest of sorted) {
    record[dest.id] = apiDestinationToCityData(dest);
  }
  return record;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return '';

  const fmt = (iso: string): string =>
    formatIsoDate(iso, { day: 'numeric', month: 'short', year: 'numeric' });

  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  return `Until ${fmt(end!)}`;
}
