/**
 * View-model of the live preview: what the map and the demo-style cards show
 * for the current trip state. Pure and unit-tested; the DOM side only draws it.
 */

import { toCoords, optionLabel, safeHttpUrl, DEFAULT_ZOOM as ADAPTER_ZOOM } from '@/modules/tripAdapter';
import { createDirectionsUrl } from '@/modules/utils';
import { dayChips, googleMapsPointUrl, type DayChip, type EDest } from './model';

export type LatLng = [number, number];

export interface PreviewItem {
  key: string;
  name: string;
  notes: string | null;
  time: string | null;
  /** Text inside the marker: the position (1, 2, …) or the option letter (A, B…). */
  label: string;
  optional: boolean;
  generic: boolean;
  coords: LatLng | null;
  mapsUrl: string | null;
  directionsUrl: string | null;
}

export interface PreviewGroup {
  key: string;
  date: string;
  label: string;
  color: string;
  hasOptions: boolean;
  items: PreviewItem[];
}

export interface CityPreview {
  key: string;
  name: string;
  center: LatLng | null;
  zoom: number;
  hotel: { name: string; coords: LatLng | null; mapsUrl: string | null; directionsUrl: string | null } | null;
  chips: DayChip[];
  /** Days that have at least one place, in calendar order. */
  groups: PreviewGroup[];
}

/**
 * The text inside each marker of a day, like the demo: the position (1, 2, …)
 * for regular places and the option letter (A, B, …) for alternatives.
 */
export function markerLabels(acts: Array<{ is_optional: boolean }>): string[] {
  let optionals = 0;
  return acts.map((a, idx) => (a.is_optional ? optionLabel(optionals++) : String(idx + 1)));
}

/** Marker/legend model of one destination, like the demo's city page. */
export function cityPreview(dest: EDest): CityPreview {
  const chips = dayChips(dest);
  const chipByDate = new Map(chips.map((c) => [c.date, c]));
  const groups: PreviewGroup[] = [];

  for (const day of dest.days) {
    if (day.activities.length === 0) continue;
    const chip = chipByDate.get(day.date);
    const labels = markerLabels(day.activities);
    const items = day.activities.map<PreviewItem>((a, idx) => {
      const coords = toCoords(a.lat, a.lng) ?? null;
      const optional = a.is_optional;
      const label = labels[idx]!;
      const stored = safeHttpUrl(a.maps_url) ?? null;
      const pinned = coords && !a.is_generic ? googleMapsPointUrl(coords[0], coords[1]) : null;
      return {
        key: a._key,
        name: a.name,
        notes: a.notes,
        time: a.time ? a.time.slice(0, 5) : null,
        label,
        optional,
        generic: a.is_generic,
        coords,
        mapsUrl: a.is_generic ? null : (stored ?? pinned),
        directionsUrl: coords && !a.is_generic ? createDirectionsUrl(coords) : null,
      };
    });
    groups.push({
      key: day._key,
      date: day.date,
      label: chip?.label ?? day.date,
      color: day.color_hex || chip?.color || '#007aff',
      hasOptions: items.some((i) => i.optional),
      items,
    });
  }
  groups.sort((a, b) => a.date.localeCompare(b.date));

  const destCoords = toCoords(dest.lat, dest.lng) ?? null;
  const hotelCoords = dest.hotel ? toCoords(dest.hotel.lat, dest.hotel.lng) ?? null : null;
  const firstLocated = groups.flatMap((g) => g.items).find((i) => i.coords)?.coords ?? null;

  return {
    key: dest._key,
    name: dest.city_name,
    center: destCoords ?? hotelCoords ?? firstLocated,
    zoom: dest.zoom_level ?? ADAPTER_ZOOM,
    hotel: dest.hotel
      ? {
          name: dest.hotel.name,
          coords: hotelCoords,
          mapsUrl: hotelCoords ? googleMapsPointUrl(hotelCoords[0], hotelCoords[1]) : null,
          directionsUrl: hotelCoords ? createDirectionsUrl(hotelCoords) : null,
        }
      : null,
    chips,
    groups,
  };
}

/** Groups to show: all of them, or only the active day's. */
export function visibleGroups(city: CityPreview, activeDate: string | null, showAll: boolean): PreviewGroup[] {
  if (showAll || !activeDate) return city.groups;
  return city.groups.filter((g) => g.date === activeDate);
}

/** Every point the map should frame for the visible groups (+ hotel). */
export function framePoints(city: CityPreview, groups: PreviewGroup[]): LatLng[] {
  const pts: LatLng[] = [];
  for (const g of groups) for (const i of g.items) if (i.coords) pts.push(i.coords);
  if (city.hotel?.coords) pts.push(city.hotel.coords);
  return pts;
}
