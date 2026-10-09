/**
 * Deep-link focus shared by the demo city pages (modules/map.ts) and the saved-trip page
 * (pages/tripDetail.ts): select a day, then open one of its activities on the map and in the
 * legend. Kept apart from map.ts so the trip page does not pull in the demo itinerary data.
 */
import * as L from 'leaflet';
import type { CityData } from '@/types';
import { announceToScreenReader } from './utils';
import { resolveFocusTarget, markerIndexFor, type FocusTarget } from './focusTarget';

export interface FocusOptions {
  /** Stable id of the activity (user trips); preferred over the name when it matches. */
  activityId?: string | null;
}

export interface FocusResult extends FocusTarget {
  /** True when the marker was found, the map moved there and its popup opened. */
  onMap: boolean;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The legend row of an activity (set up by the legend builders via data-activity-index). */
export function legendItemFor(dayKey: string, activityIndex: number): HTMLElement | null {
  const grid = document.getElementById('legend-grid');
  if (!grid) return null;
  const group = Array.from(grid.querySelectorAll<HTMLElement>('.day-group')).find((g) => g.dataset.day === dayKey);
  return group?.querySelector<HTMLElement>(`li.legend-item[data-activity-index="${activityIndex}"]`) ?? null;
}

function highlightLegendItem(item: HTMLElement | null, scroll: boolean): void {
  document.querySelectorAll('#legend-grid .legend-item.is-focused').forEach((el) => el.classList.remove('is-focused'));
  if (!item) return;
  item.classList.add('is-focused');
  item.setAttribute('tabindex', '-1');
  item.focus({ preventScroll: true });
  if (scroll) item.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/**
 * Select a day and focus one of its activities: the day filter, the marker (map flies there and
 * its popup opens), the legend row (highlighted, focused) and a screen-reader announcement.
 *
 * Forgiving by design (the arguments come from a URL): an unknown day or activity resolves to
 * less, never to an error. An activity without coordinates still gets its day selected and its
 * row highlighted, but the map stays where it is. Returns what was focused, or null when
 * nothing matched. `map` may be null (a city without any location).
 *
 * The URL is not touched: callers decide whether to normalise it.
 */
export function selectDayAndFocusActivity(
  dayKey: string | null,
  activityName: string | null,
  daySelector: HTMLElement | null,
  map: L.Map | null,
  data: CityData,
  markersByDay: Record<string, L.Marker[]>,
  options: FocusOptions = {}
): FocusResult | null {
  const target = resolveFocusTarget(data, { day: dayKey, activity: activityName, activityId: options.activityId });
  if (!target) return null;
  const day = data.days[target.dayKey]!;

  const dayBtn = daySelector
    ? Array.from(daySelector.querySelectorAll<HTMLElement>('.day-btn')).find((b) => b.dataset.day === target.dayKey)
    : undefined;
  // A second click on the active day would clear the filter, so only click when it is not active.
  if (dayBtn && !dayBtn.classList.contains('active')) dayBtn.click();

  if (target.activityIndex === null) {
    announceToScreenReader(`Showing ${day.label}`);
    return { ...target, onMap: false };
  }

  const activity = day.activities[target.activityIndex]!;
  const markerIdx = markerIndexFor(data, target.dayKey, target.activityIndex);
  const marker = markerIdx === null ? undefined : markersByDay[target.dayKey]?.[markerIdx];
  const onMap = !!(map && marker);

  // Rows with a pin leave the scroll to the map (the popup is what the visitor came for).
  highlightLegendItem(legendItemFor(target.dayKey, target.activityIndex), !onMap);

  if (map && marker) {
    if (!map.hasLayer(marker)) marker.addTo(map);
    marker.openPopup();
    const reduced = prefersReducedMotion();
    map.flyTo(marker.getLatLng(), 15, { animate: !reduced, duration: 0.8 });
    map.getContainer().scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    announceToScreenReader(`${activity.name}, ${day.label}. Opened on the map.`);
  } else {
    announceToScreenReader(`${activity.name}, ${day.label}. This place has no location on the map.`);
  }
  return { ...target, onMap };
}
