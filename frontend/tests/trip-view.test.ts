import { describe, it, expect } from 'vitest';
import {
  buildTripStops,
  describeCounts,
  describeTripError,
  destinationCoords,
  formatRange,
  formatShortRange,
  groupTrips,
  parseTripLocation,
  resolveDestIndex,
  summarizeTrip,
  tripDateSpan,
  tripHref,
} from '@/modules/tripView';
import type { ApiDestination, ApiTrip } from '@/types';

const NOW = new Date(2027, 1, 10, 12, 0, 0); // 10 Feb 2027, local noon

function dest(over: Partial<ApiDestination> = {}): ApiDestination {
  return {
    id: 'd1', trip_id: 't1', city_name: 'Tokyo', country: 'Japan', start_date: null, end_date: null,
    lat: 35.6, lng: 139.7, zoom_level: 12, order_index: 0, days: [], ...over,
  };
}

function trip(over: Partial<ApiTrip> = {}, destinations: ApiDestination[] = []): ApiTrip {
  return {
    id: 't1', user_id: 'u', name: 'Trip', description: null, start_date: null, end_date: null,
    cover_image_url: null, is_public: false, public_slug: null, destinations, ...over,
  };
}

const act = (over: Record<string, unknown> = {}) => ({
  id: 'a', name: 'x', lat: 1, lng: 2, notes: null, is_optional: false, is_generic: false,
  maps_url: null, order_index: 0, time: null, ...over,
});

describe('date formatting', () => {
  it('formats ranges, single dates and junk', () => {
    expect(formatRange('2027-02-22', '2027-03-01')).toBe('22 Feb 2027 – 1 Mar 2027');
    expect(formatRange('2027-02-22', '2027-02-22')).toBe('22 Feb 2027');
    expect(formatRange('2027-02-22', null)).toBe('From 22 Feb 2027');
    expect(formatRange(null, '2027-02-22')).toBe('Until 22 Feb 2027');
    expect(formatRange(null, null)).toBe('');
    expect(formatRange('nope', '2027-13-45')).toBe('');
  });

  it('short ranges match the demo cards', () => {
    expect(formatShortRange('2027-03-02', '2027-03-03')).toBe('2–3 Mar');
    expect(formatShortRange('2027-02-22', '2027-03-01')).toBe('22 Feb – 1 Mar');
    expect(formatShortRange('2027-03-02', '2027-03-02')).toBe('2 Mar');
    expect(formatShortRange(null, null)).toBe('');
  });

  it('falls back to destination dates when the trip has none', () => {
    const t = trip({}, [dest({ start_date: '2027-03-05', end_date: '2027-03-07' }), dest({ id: 'd2', start_date: '2027-03-01', end_date: '2027-03-04' })]);
    expect(tripDateSpan(t)).toEqual({ start: '2027-03-01', end: '2027-03-07' });
  });
});

describe('summarizeTrip', () => {
  it('counts cities, days and places', () => {
    const t = trip({ start_date: '2027-03-01', end_date: '2027-03-08' }, [
      dest({ days: [{ id: '1', date: '2027-03-01', label: null, color_hex: null, order_index: 0, activities: [act(), act({ id: 'b' })] }] }),
      dest({ id: 'd2' }),
    ]);
    const s = summarizeTrip(t, NOW);
    expect(s.cityCount).toBe(2);
    expect(s.dayCount).toBe(8);
    expect(s.placeCount).toBe(2);
    expect(describeCounts(s)).toEqual(['2 cities', '8 days', '2 places']);
  });

  it('uses singular words', () => {
    expect(describeCounts({ cityCount: 1, dayCount: 1, placeCount: 1 })).toEqual(['1 city', '1 day', '1 place']);
  });

  it('upcoming: counts calendar days, "Tomorrow" the day before', () => {
    expect(summarizeTrip(trip({ start_date: '2027-02-22', end_date: '2027-03-01' }), NOW)).toMatchObject({
      phase: 'upcoming', daysUntil: 12, phaseLabel: 'In 12 days', progress: 0,
    });
    expect(summarizeTrip(trip({ start_date: '2027-02-11', end_date: '2027-02-12' }), NOW).phaseLabel).toBe('Tomorrow');
  });

  it('active: day number and progress, including first and last day', () => {
    const t = (start: string, end: string) => summarizeTrip(trip({ start_date: start, end_date: end }), NOW);
    expect(t('2027-02-08', '2027-02-17')).toMatchObject({ phase: 'active', dayNumber: 3, phaseLabel: 'Day 3 of 10', progress: 30 });
    expect(t('2027-02-10', '2027-02-12')).toMatchObject({ phase: 'active', dayNumber: 1 });
    expect(t('2027-02-08', '2027-02-10')).toMatchObject({ phase: 'active', dayNumber: 3, progress: 100 });
  });

  it('past and undated', () => {
    expect(summarizeTrip(trip({ start_date: '2027-02-01', end_date: '2027-02-09' }), NOW)).toMatchObject({ phase: 'past', phaseLabel: 'Completed', progress: 100 });
    expect(summarizeTrip(trip(), NOW)).toMatchObject({ phase: 'undated', progress: null, daysUntil: null });
  });

  it('a start without an end is a one-day trip; an end before the start does not blow up', () => {
    expect(summarizeTrip(trip({ start_date: '2027-02-10' }), NOW)).toMatchObject({ phase: 'active', dayCount: 1 });
    expect(summarizeTrip(trip({ start_date: '2027-03-10', end_date: '2027-03-01' }), NOW).dayCount).toBe(1);
  });

  it('tolerates a trip with no destinations array content', () => {
    expect(summarizeTrip(trip(), NOW)).toMatchObject({ cityCount: 0, dayCount: 0, placeCount: 0 });
  });
});

describe('groupTrips', () => {
  it('orders in progress, upcoming (soonest first), undated, past (latest first) and drops empty groups', () => {
    const mk = (id: string, s: string | null, e: string | null) => trip({ id, name: id, start_date: s, end_date: e });
    const groups = groupTrips(
      [mk('past-old', '2020-01-01', '2020-01-05'), mk('later', '2027-06-01', '2027-06-05'), mk('none', null, null),
        mk('now', '2027-02-09', '2027-02-12'), mk('soon', '2027-03-01', '2027-03-02'), mk('past-new', '2027-01-01', '2027-01-05')],
      NOW,
    );
    expect(groups.map((g) => g.title)).toEqual(['In progress', 'Upcoming', 'No dates yet', 'Past trips']);
    expect(groups.map((g) => g.trips.map((t) => t.id))).toEqual([['now'], ['soon', 'later'], ['none'], ['past-new', 'past-old']]);
    expect(groupTrips([], NOW)).toEqual([]);
  });
});

describe('buildTripStops', () => {
  it('orders by order_index, numbers from 1 and labels repeat visits uniquely', () => {
    const t = trip({}, [
      dest({ id: 'c', city_name: 'Tokyo', order_index: 2 }),
      dest({ id: 'a', city_name: 'Tokyo', order_index: 0 }),
      dest({ id: 'b', city_name: 'Kyoto', order_index: 1 }),
      dest({ id: 'd', city_name: 'Tokyo', order_index: 3 }),
    ]);
    const stops = buildTripStops(t);
    expect(stops.map((s) => [s.key, s.number, s.label])).toEqual([
      ['a', 1, 'Tokyo'], ['b', 2, 'Kyoto'], ['c', 3, 'Tokyo (return)'], ['d', 4, 'Tokyo (visit 3)'],
    ]);
    expect(stops.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it('names blank cities and counts days/places', () => {
    const [s] = buildTripStops(trip({}, [dest({ city_name: '  ', days: [{ id: '1', date: '2027-01-01', label: null, color_hex: null, order_index: 0, activities: [act()] }] })]));
    expect(s).toMatchObject({ name: 'Stop 1', dayCount: 1, placeCount: 1 });
  });

  it('coordinates: destination, else hotel, else first located activity, else null (never 0,0)', () => {
    const day = (acts: unknown[]) => [{ id: '1', date: '2027-01-01', label: null, color_hex: null, order_index: 0, activities: acts as never }];
    expect(destinationCoords(dest({ lat: '35.5000000', lng: '139.5' }))).toEqual([35.5, 139.5]);
    expect(destinationCoords(dest({ lat: null, lng: null, hotel: { id: 'h', name: 'H', lat: 1, lng: 2, check_in_date: null, check_out_date: null, url: null } }))).toEqual([1, 2]);
    expect(destinationCoords(dest({ lat: null, lng: null, days: day([act({ lat: null, lng: null }), act({ lat: 7, lng: 8 })]) }))).toEqual([7, 8]);
    expect(destinationCoords(dest({ lat: '', lng: ' ', days: day([act({ lat: 'abc', lng: 3 })]) }))).toBeNull();
    expect(destinationCoords(dest({ lat: 95, lng: 0 }))).toBeNull();
  });

  it('assigns the demo palette in order and wraps', () => {
    const many = Array.from({ length: 9 }, (_, i) => dest({ id: String(i), order_index: i }));
    const stops = buildTripStops(trip({}, many));
    expect(stops[0]!.color).toBe('#ff3b30');
    expect(stops[8]!.color).toBe(stops[0]!.color);
  });
});

describe('URLs', () => {
  it('builds overview and city links, owner and shared', () => {
    expect(tripHref({ tripId: '7' })).toBe('trip.html?tripId=7');
    expect(tripHref({ tripId: '7' }, 2)).toBe('trip.html?tripId=7&destIndex=2');
    expect(tripHref({ tripId: '7' }, 0)).toBe('trip.html?tripId=7&destIndex=0');
    expect(tripHref({ slug: 'abc-1' }, 1)).toBe('trip.html?slug=abc-1&destIndex=1');
  });

  it('encodes hostile ids', () => {
    expect(tripHref({ tripId: 'a&b=c#d' })).toBe('trip.html?tripId=a%26b%3Dc%23d');
  });

  it('parses the location: no destIndex is the overview, junk is the overview', () => {
    expect(parseTripLocation('?tripId=7')).toEqual({
      tripId: '7', slug: null, destIndex: null, day: null, activity: null, activityId: null,
    });
    expect(parseTripLocation('?tripId=7&destIndex=3')).toMatchObject({ destIndex: 3 });
    expect(parseTripLocation('?slug=s&destIndex=0')).toMatchObject({ slug: 's', destIndex: 0 });
    expect(parseTripLocation('?tripId=7&destIndex=abc').destIndex).toBeNull();
    expect(parseTripLocation('?tripId=7&destIndex=-1').destIndex).toBeNull();
    expect(parseTripLocation('?tripId=7&destIndex=1.5').destIndex).toBeNull();
  });

  it('parses the search deep-link parameters; blank or absurd values count as absent', () => {
    expect(parseTripLocation('?tripId=7&destIndex=1&day=2031-05-02&activity=Caf%C3%A9+%26+Ramen&activityId=a-1')).toMatchObject({
      destIndex: 1,
      day: '2031-05-02',
      activity: 'Café & Ramen',
      activityId: 'a-1',
    });
    expect(parseTripLocation('?tripId=7&day=&activity=%20&activityId=')).toMatchObject({ day: null, activity: null, activityId: null });
    expect(parseTripLocation(`?activity=${'x'.repeat(5000)}`).activity).toBeNull();
    expect(() => parseTripLocation('?activity=%E0%A4%A&day=%')).not.toThrow(); // malformed escapes never throw
  });

  it('an out-of-range city falls back to the overview', () => {
    expect(resolveDestIndex(1, 2)).toBe(1);
    expect(resolveDestIndex(2, 2)).toBeNull();
    expect(resolveDestIndex(0, 0)).toBeNull();
    expect(resolveDestIndex(null, 3)).toBeNull();
  });
});

describe('describeTripError', () => {
  it('404/403 are definite answers, not retryable', () => {
    expect(describeTripError({ status: 404 }, 'owner')).toMatchObject({ kind: 'not-found', retryable: false });
    expect(describeTripError({ status: 404 }, 'owner').message).toContain("don't have access");
    expect(describeTripError({ status: 403 }, 'owner')).toMatchObject({ kind: 'forbidden', retryable: false });
    expect(describeTripError({ status: 404 }, 'public')).toMatchObject({ kind: 'not-found', title: 'Shared trip not available' });
    expect(describeTripError({ status: 400 }, 'public').kind).toBe('not-found');
  });

  it('401 is the session redirect; everything else (network, 5xx, junk) is retryable', () => {
    expect(describeTripError({ status: 401 }, 'owner')).toMatchObject({ kind: 'session', retryable: false });
    for (const err of [{ status: 500 }, { status: 502 }, new TypeError('Failed to fetch'), null, undefined, 'x']) {
      expect(describeTripError(err, 'owner')).toMatchObject({ kind: 'unavailable', retryable: true });
      expect(describeTripError(err, 'public')).toMatchObject({ kind: 'unavailable', retryable: true });
    }
  });
});
