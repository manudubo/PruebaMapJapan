/**
 * Trip Adapter
 *
 * Converts API response types (ApiTrip / ApiDestination / ApiDay / ApiActivity)
 * into the existing app data structures (CityData / Day / Activity) so that the
 * existing map.ts, search.ts, and widget modules work without any modifications.
 */

import type {
  ApiTrip,
  ApiDestination,
  ApiDay,
  ApiActivity,
  CityData,
  Day,
  Activity,
  Hotel,
} from '@/types';

// ---------------------------------------------------------------------------
// Activity adapter
// ---------------------------------------------------------------------------

/**
 * Convert an ApiActivity to the legacy Activity shape used by map.ts.
 *
 * Priority for coordinates: activity's own lat/lng.
 * The `optional` field in the legacy model is a label string (e.g. "A", "1").
 * The `is_optional` flag + optional_label from the API drives that.
 */
export function apiActivityToActivity(activity: ApiActivity): Activity {
  return {
    name: activity.name,
    coords: [activity.lat, activity.lng],
    notes: activity.notes,
    optional: activity.is_optional ? (activity.optional_label ?? 'A') : undefined,
    isGeneric: activity.is_generic,
  };
}

// ---------------------------------------------------------------------------
// Day adapter
// ---------------------------------------------------------------------------

/**
 * Convert an ApiDay to the legacy Day shape used by map.ts.
 *
 * The legacy `hasOptions` flag is true when at least one activity is optional.
 */
export function apiDayToDay(day: ApiDay): Day {
  const activities = day.activities
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map(apiActivityToActivity);

  const hasOptions = day.activities.some((a) => a.is_optional);

  return {
    label: day.label,
    color: day.color_hex,
    hasOptions: hasOptions || undefined,
    activities,
  };
}

// ---------------------------------------------------------------------------
// Destination (CityData) adapter
// ---------------------------------------------------------------------------

/**
 * Convert an ApiDestination to the legacy CityData shape.
 *
 * - `dates` is built from start_date and end_date when available.
 * - `hotel` falls back to a placeholder at the destination centre when absent.
 * - `days` are keyed by ISO date string (YYYY-MM-DD) as expected by map.ts.
 */
export function apiDestinationToCityData(dest: ApiDestination): CityData {
  // Build the hotel object
  const hotel: Hotel = dest.hotel
    ? {
        name: dest.hotel.name,
        coords: [dest.hotel.lat, dest.hotel.lng],
      }
    : {
        name: dest.city_name,
        coords: [dest.lat, dest.lng],
      };

  // Build a human-readable date range
  const dates = buildDateRange(dest.start_date, dest.end_date);

  // Build the days record keyed by ISO date
  const days: Record<string, Day> = {};
  const sortedDays = dest.days.slice().sort((a, b) => a.order_index - b.order_index);
  for (const apiDay of sortedDays) {
    // Use the date field as key; fall back to day id if date is missing
    const key = apiDay.date ?? apiDay.id;
    days[key] = apiDayToDay(apiDay);
  }

  return {
    name: dest.city_name,
    center: [dest.lat, dest.lng],
    zoom: dest.zoom_level,
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

  const fmt = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `Desde ${fmt(start)}`;
  return `Hasta ${fmt(end!)}`;
}
