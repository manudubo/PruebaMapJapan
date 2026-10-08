import type { ApiTrip } from '@/types';
import type { SearchResult } from './search';
import { formatIsoDate } from './dates';
import { toCoords } from './tripAdapter';

/**
 * Format date key to readable label
 */
export function formatDateLabel(dateKey: string): string {
  // Local calendar day (BIZ-11); fall back to the raw key if it isn't a date.
  return formatIsoDate(dateKey, { weekday: 'long', day: 'numeric', month: 'long' }) || dateKey;
}

/** trip.html deep link; `extra` adds destIndex/day/activity. */
export function tripUrl(tripId: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ tripId, ...extra });
  return `trip.html?${params.toString()}`;
}

/**
 * Index entries for one of the user's trips: the trip, its cities, hotels, days and
 * activities. Destination order and day keys follow tripAdapter so `destIndex`, `day` and
 * `activity` address what the trip page actually renders.
 */
export function buildTripEntries(trip: ApiTrip): SearchResult[] {
  const out: SearchResult[] = [];
  const tripId = String(trip.id);
  const destinations = Array.isArray(trip.destinations) ? trip.destinations : [];

  const range = [trip.start_date, trip.end_date]
    .filter((d): d is string => !!d)
    .map((d) => formatIsoDate(d, { day: 'numeric', month: 'short', year: 'numeric' }) || d)
    .join(' – ');
  const cityCount = destinations.length;
  out.push({
    type: 'trip',
    title: trip.name,
    subtitle: [range, cityCount ? `${cityCount} ${cityCount === 1 ? 'city' : 'cities'}` : '']
      .filter(Boolean)
      .join(' · '),
    city: '',
    cityKey: tripId,
    tripId,
    url: tripUrl(tripId),
  });

  destinations
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .forEach((dest, destIdx) => {
      const base = { city: dest.city_name, cityKey: String(dest.id), tripId };
      const context = `${dest.city_name} · ${trip.name}`;
      const destParam = { destIndex: String(destIdx) };
      const cityUrl = tripUrl(tripId, destParam);

      out.push({
        ...base,
        type: 'city',
        title: dest.city_name,
        subtitle: `${trip.name}${dest.start_date ? ' · ' + formatIsoDate(dest.start_date, { day: 'numeric', month: 'short' }) : ''}`,
        url: cityUrl,
      });

      if (dest.hotel) {
        out.push({
          ...base,
          type: 'hotel',
          title: dest.hotel.name,
          subtitle: `Hotel in ${dest.city_name} · ${trip.name}`,
          coords: toCoords(dest.hotel.lat, dest.hotel.lng),
          url: cityUrl,
        });
      }

      // Same keys as apiDestinationToCityData (calendar order; "date#id" for a repeated date).
      const seen = new Set<string>();
      dest.days
        .slice()
        .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.order_index - b.order_index)
        .forEach((day) => {
          const baseKey = day.date ?? String(day.id);
          const dayKey = seen.has(baseKey) ? `${baseKey}#${day.id}` : baseKey;
          seen.add(baseKey);
          const dayLabel = day.label || day.date;

          out.push({
            ...base,
            type: 'day',
            context,
            title: `${dayLabel} — ${dest.city_name}`,
            subtitle: formatDateLabel(day.date),
            date: dayKey,
            color: day.color_hex ?? undefined,
            url: tripUrl(tripId, { ...destParam, day: dayKey }),
          });

          day.activities.forEach((act) => {
            if (act.is_generic) return;
            out.push({
              ...base,
              type: 'activity',
              context,
              title: act.name,
              subtitle: act.notes ? act.notes : `${dayLabel} · ${dest.city_name}`,
              date: dayKey,
              color: day.color_hex ?? undefined,
              coords: toCoords(act.lat, act.lng),
              url: tripUrl(tripId, { ...destParam, day: dayKey, activity: act.name }),
            });
          });
        });
    });

  return out;
}

