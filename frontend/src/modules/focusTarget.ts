/**
 * Which day and activity a search deep link points at (trip.html?...&day=...&activity=...&activityId=...).
 *
 * Pure and DOM-free so every edge case is unit-testable. The URL is untrusted input: nothing here
 * throws, and anything that does not match a real day/activity resolves to "less" (the day only,
 * or nothing) rather than to an error.
 */

import type { ApiDestination, CityData } from '@/types';

/** What the URL asked for. All optional; empty strings count as absent. */
export interface FocusRequest {
  day?: string | null;
  activity?: string | null;
  activityId?: string | null;
}

/** What it resolved to on a given city. */
export interface FocusTarget {
  dayKey: string;
  /** Index in the day's `activities`, or null when only the day matched. */
  activityIndex: number | null;
}

/** Longest URL value considered; anything longer cannot be a name we stored. */
const MAX_PARAM_LENGTH = 2000;

/** Normalise for tolerant name matching: Unicode NFC, collapsed whitespace, case-folded. */
export function normalizeName(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

/** Trimmed, length-capped param value, or null when absent/blank. */
export function cleanParam(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > MAX_PARAM_LENGTH) return null;
  return trimmed;
}

/** True when the request names nothing to focus. */
export function isEmptyRequest(req: FocusRequest | null | undefined): boolean {
  return !req || (!cleanParam(req.day) && !cleanParam(req.activity) && !cleanParam(req.activityId));
}

function findByName(data: CityData, dayKey: string, name: string): number {
  const activities = data.days[dayKey]?.activities ?? [];
  const exact = activities.findIndex((a) => a.name === name);
  if (exact >= 0) return exact;
  const wanted = normalizeName(name);
  return activities.findIndex((a) => normalizeName(a.name) === wanted);
}

/**
 * Resolve a request against one city.
 *
 *  1. `activityId` wins: it is unique, so it ignores the (possibly stale) day and name.
 *  2. A name is looked up inside the requested day first, so two places called "Ramen" on
 *     different days are told apart by `day`.
 *  3. A name whose day is missing or unknown is looked up across the whole city (first match).
 *  4. A known day with an unknown or absent name resolves to the day alone.
 *  5. Nothing matches: null.
 */
export function resolveFocusTarget(data: CityData, req: FocusRequest | null | undefined): FocusTarget | null {
  if (!req) return null;
  const day = cleanParam(req.day);
  const name = cleanParam(req.activity);
  const id = cleanParam(req.activityId);
  const dayKeys = Object.keys(data.days);
  const dayKnown = day !== null && Object.prototype.hasOwnProperty.call(data.days, day);

  if (id !== null) {
    for (const dayKey of dayKeys) {
      const index = data.days[dayKey]!.activities.findIndex((a) => a.id === id);
      if (index >= 0) return { dayKey, activityIndex: index };
    }
  }

  if (name !== null) {
    if (dayKnown) {
      const index = findByName(data, day, name);
      if (index >= 0) return { dayKey: day, activityIndex: index };
    } else {
      for (const dayKey of dayKeys) {
        const index = findByName(data, dayKey, name);
        if (index >= 0) return { dayKey, activityIndex: index };
      }
    }
  }

  return dayKnown ? { dayKey: day, activityIndex: null } : null;
}

/**
 * Position (in visiting order) of the destination that holds an activity id, or null.
 * Lets a link without a usable `destIndex` still open on the right city.
 */
export function findDestinationOfActivity(dests: ApiDestination[], activityId: string | null | undefined): number | null {
  const id = cleanParam(activityId);
  if (id === null) return null;
  const index = dests.findIndex((d) => (d.days ?? []).some((day) => (day.activities ?? []).some((a) => String(a.id) === id)));
  return index >= 0 ? index : null;
}

/** Index of an activity's marker among the day's markers (only located activities have one). */
export function markerIndexFor(data: CityData, dayKey: string, activityIndex: number): number | null {
  const activities = data.days[dayKey]?.activities ?? [];
  const activity = activities[activityIndex];
  if (!activity?.coords) return null;
  return activities.slice(0, activityIndex).filter((a) => a.coords).length;
}
