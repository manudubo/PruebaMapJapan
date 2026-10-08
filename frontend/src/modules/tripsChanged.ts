/**
 * Fired on `window` after a trip write (create/update/delete, destinations, days, activities)
 * succeeded, so caches built from trip data (the search index) can drop what they hold.
 */
export const TRIPS_CHANGED_EVENT = 'travelmap:trips-changed';

export function notifyTripsChanged(): void {
  window.dispatchEvent(new Event(TRIPS_CHANGED_EVENT));
}
