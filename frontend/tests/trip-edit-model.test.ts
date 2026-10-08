import { describe, it, expect } from 'vitest';
import {
  parsePlaceLabel, hitToPlace, googleMapsPointUrl, dominantCountry, roundCoord,
  dayChips, dayColor, chipLabel, suggestDestinationDates, shortRange, MAX_CHIP_DAYS,
  nextOrderIndex, moveItem, renumber,
  validateTripFields, validateDestinationFields, validateActivityFields, isValid,
  routeStops, tripSummary, publishChecklist, normalizeTrip, isTempId, newTempId, LIMITS,
  type EDest, type ETrip,
} from '@/pages/trip-edit/model';
import type { ApiTrip } from '@/types';

const dest = (over: Partial<EDest> = {}): EDest => ({
  _key: 'c1', id: '1', trip_id: '1', city_name: 'Tokyo', country: 'Japan', start_date: null, end_date: null,
  lat: 35.68, lng: 139.69, zoom_level: 12, order_index: 0, days: [], hotel: null, ...over,
});

describe('place parsing', () => {
  it('takes the first part as the name and the last as the country', () => {
    expect(parsePlaceLabel('Kyoto, Kyoto Prefecture, Japan')).toEqual({ name: 'Kyoto', country: 'Japan' });
  });
  it('a single part has no country', () => {
    expect(parsePlaceLabel('Atlantis')).toEqual({ name: 'Atlantis', country: '' });
  });
  it('trims, drops empty parts and caps to the API limits', () => {
    expect(parsePlaceLabel('  Nara ,, ,  Japan  ')).toEqual({ name: 'Nara', country: 'Japan' });
    const long = parsePlaceLabel(`${'x'.repeat(400)}, ${'y'.repeat(300)}`);
    expect(long.name).toHaveLength(255);
    expect(long.country).toHaveLength(100);
    expect(parsePlaceLabel('')).toEqual({ name: '', country: '' });
    expect(parsePlaceLabel(' , , ')).toEqual({ name: '', country: '' });
  });
  it('keeps hostile text as plain text (rendering uses textContent)', () => {
    expect(parsePlaceLabel('<img src=x onerror=alert(1)>, Japan').name).toBe('<img src=x onerror=alert(1)>');
  });
  it('hitToPlace parses coordinates and rejects unusable hits', () => {
    expect(hitToPlace({ lat: '35.0116', lon: '135.7681', display_name: 'Kyoto, Japan' })).toEqual({
      name: 'Kyoto', country: 'Japan', lat: 35.0116, lng: 135.7681, label: 'Kyoto, Japan',
    });
    expect(hitToPlace({ lat: 'abc', lon: '1', display_name: 'X, Y' })).toBeNull();
    expect(hitToPlace({ lat: '91', lon: '1', display_name: 'X, Y' })).toBeNull();
    expect(hitToPlace({ lat: '1', lon: '181', display_name: 'X, Y' })).toBeNull();
    expect(hitToPlace({ lat: '1', lon: '1', display_name: ' , ' })).toBeNull();
  });
  it('maps link and coordinate helpers', () => {
    expect(googleMapsPointUrl(35.01161234567, 135.7681)).toBe('https://www.google.com/maps/search/?api=1&query=35.011612%2C135.7681');
    expect(roundCoord(1.23456789)).toBe(1.234568);
    expect(dominantCountry([{ country: 'Japan' }, { country: 'Japan' }, { country: 'Korea' }, { country: '' }])).toBe('Japan');
    expect(dominantCountry([])).toBe('');
  });
});

describe('day chips', () => {
  it('lists every date of the range, even without day rows (virtual days)', () => {
    const chips = dayChips(dest({ start_date: '2026-02-22', end_date: '2026-02-24' }));
    expect(chips.map((c) => c.date)).toEqual(['2026-02-22', '2026-02-23', '2026-02-24']);
    expect(chips.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(chips.every((c) => c.dayId === null && c.activityCount === 0)).toBe(true);
    expect(chips[0]!.label).toBe('Sun 22 Feb');
    expect(chips.map((c) => c.color)).toEqual([dayColor(0), dayColor(1), dayColor(2)]);
  });
  it('merges stored days (label, colour, counts) and keeps days outside the range', () => {
    const chips = dayChips(dest({
      start_date: '2026-02-22', end_date: '2026-02-23',
      days: [
        { _key: 'd1', id: '5', date: '2026-02-23', label: 'Arrival', color_hex: '#123456', order_index: 0, activities: [{ _key: 'a', id: '1', name: 'x', lat: null, lng: null, notes: null, is_optional: false, is_generic: false, maps_url: null, order_index: 0, time: null }] },
        { _key: 'd2', id: '6', date: '2026-03-05', label: null, color_hex: null, order_index: 1, activities: [] },
      ],
    }));
    expect(chips.map((c) => c.date)).toEqual(['2026-02-22', '2026-02-23', '2026-03-05']);
    expect(chips[1]).toMatchObject({ label: 'Arrival', color: '#123456', dayId: '5', activityCount: 1, outOfRange: false });
    expect(chips[2]).toMatchObject({ outOfRange: true, dayId: '6' });
  });
  it('a start date alone is one chip; no dates and no days is none', () => {
    expect(dayChips(dest({ start_date: '2026-02-22' })).map((c) => c.date)).toEqual(['2026-02-22']);
    expect(dayChips(dest())).toEqual([]);
  });
  it('an inverted range yields no range chips (existing days still show)', () => {
    expect(dayChips(dest({ start_date: '2026-02-24', end_date: '2026-02-22' }))).toEqual([]);
  });
  it('caps a huge range', () => {
    const chips = dayChips(dest({ start_date: '2026-01-01', end_date: '2030-01-01' }));
    expect(chips).toHaveLength(MAX_CHIP_DAYS);
  });
  it('60 days is fine', () => {
    expect(dayChips(dest({ start_date: '2026-01-01', end_date: '2026-03-01' }))).toHaveLength(60);
  });
  it('invalid stored dates are ignored', () => {
    expect(dayChips(dest({ start_date: '2026-13-45', end_date: '2026-14-01' }))).toEqual([]);
  });
  it('colours cycle and tolerate negatives', () => {
    expect(dayColor(8)).toBe(dayColor(0));
    expect(dayColor(-1)).toBe(dayColor(7));
    expect(chipLabel('nope')).toBe('nope');
  });
});

describe('suggestDestinationDates', () => {
  it('first destination starts on the trip start and lasts `nights`', () => {
    expect(suggestDestinationDates({ start_date: '2026-02-22', end_date: '2026-03-24' }, [])).toEqual({ start_date: '2026-02-22', end_date: '2026-02-24' });
  });
  it('the next one starts the day the previous ends', () => {
    expect(suggestDestinationDates({ start_date: '2026-02-22', end_date: '2026-03-24' }, [{ start_date: '2026-02-22', end_date: '2026-02-24' }], 3))
      .toEqual({ start_date: '2026-02-24', end_date: '2026-02-27' });
  });
  it('is clamped to the trip end', () => {
    expect(suggestDestinationDates({ start_date: '2026-02-22', end_date: '2026-02-23' }, [])).toEqual({ start_date: '2026-02-22', end_date: '2026-02-23' });
  });
  it('after the trip end it collapses to a single day instead of inverting', () => {
    const r = suggestDestinationDates({ start_date: '2026-02-22', end_date: '2026-02-23' }, [{ start_date: '2026-02-22', end_date: '2026-02-25' }]);
    expect(r.start_date).toBe('2026-02-25');
    expect(r.end_date).toBe('2026-02-25');
  });
  it('no trip dates -> no dates', () => {
    expect(suggestDestinationDates({ start_date: null, end_date: null }, [])).toEqual({ start_date: null, end_date: null });
  });
  it('uses the last dated destination', () => {
    expect(suggestDestinationDates({ start_date: null, end_date: null }, [{ start_date: '2026-05-01', end_date: '2026-05-03' }, { start_date: null, end_date: null }]).start_date).toBe('2026-05-03');
  });
  it('shortRange', () => {
    expect(shortRange('2026-02-22', '2026-03-01')).toBe('22 Feb – 1 Mar');
    expect(shortRange('2026-02-22', '2026-02-22')).toBe('22 Feb');
    expect(shortRange(null, null)).toBe('');
    expect(shortRange(null, '2026-03-01')).toBe('1 Mar');
  });
});

describe('ordering', () => {
  it('nextOrderIndex', () => {
    expect(nextOrderIndex([])).toBe(0);
    expect(nextOrderIndex([{ order_index: 0 }, { order_index: 4 }])).toBe(5);
  });
  it('moveItem moves, clamps and returns the same array for a no-op', () => {
    const a = ['a', 'b', 'c', 'd'];
    expect(moveItem(a, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(a, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(a, 1, 99)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveItem(a, 1, -5)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveItem(a, 1, 1)).toBe(a);
    expect(moveItem(a, 9, 0)).toBe(a);
    expect(a).toEqual(['a', 'b', 'c', 'd']);
  });
  it('renumber', () => {
    expect(renumber([{ order_index: 5 }, { order_index: 5 }]).map((x) => x.order_index)).toEqual([0, 1]);
  });
});

describe('validation', () => {
  it('trip: name required, dates ordered', () => {
    expect(validateTripFields({ name: '  ', start_date: null, end_date: null }).name).toBeTruthy();
    expect(validateTripFields({ name: 'x'.repeat(256), start_date: null, end_date: null }).name).toBeTruthy();
    expect(isValid(validateTripFields({ name: 'x'.repeat(LIMITS.tripName), start_date: '2026-01-01', end_date: '2026-01-01' }))).toBe(true);
    expect(validateTripFields({ name: 'T', start_date: '2026-02-02', end_date: '2026-02-01' }).end_date).toMatch(/before/);
    expect(validateTripFields({ name: 'T', start_date: '2026-02-31', end_date: null }).start_date).toBeTruthy();
    expect(validateTripFields({ name: 'T', start_date: null, end_date: 'garbage' }).end_date).toBeTruthy();
  });
  it('destination', () => {
    expect(validateDestinationFields({ city_name: '', country: '', start_date: null, end_date: null })).toMatchObject({ city_name: expect.any(String), country: expect.any(String) });
    expect(validateDestinationFields({ city_name: 'A', country: 'B', start_date: '2026-02-02', end_date: '2026-02-01' }).end_date).toBeTruthy();
    expect(isValid(validateDestinationFields({ city_name: 'A', country: 'B', start_date: '2026-02-01', end_date: '2026-02-01' }))).toBe(true);
    expect(validateDestinationFields({ city_name: 'x'.repeat(256), country: 'y'.repeat(101), start_date: null, end_date: null })).toMatchObject({ city_name: expect.any(String), country: expect.any(String) });
  });
  it('activity: name, time and link', () => {
    expect(validateActivityFields({ name: ' ', time: null, maps_url: null }).name).toBeTruthy();
    expect(validateActivityFields({ name: 'A', time: '25:00', maps_url: null }).time).toBeTruthy();
    expect(validateActivityFields({ name: 'A', time: '09:30', maps_url: null }).time).toBeUndefined();
    expect(validateActivityFields({ name: 'A', time: '23:59:59', maps_url: null }).time).toBeUndefined();
    expect(validateActivityFields({ name: 'A', time: null, maps_url: 'javascript:alert(1)' }).maps_url).toBeTruthy();
    expect(validateActivityFields({ name: 'A', time: null, maps_url: 'ftp://x' }).maps_url).toBeTruthy();
    expect(validateActivityFields({ name: 'A', time: null, maps_url: 'https://maps.app.goo.gl/x' }).maps_url).toBeUndefined();
    expect(validateActivityFields({ name: 'A', time: '', maps_url: '' })).toEqual({});
  });
});

const apiTrip = (): ApiTrip => ({
  id: 3 as unknown as string, user_id: 1 as unknown as string, name: 'Japan', description: null,
  start_date: '2026-02-22', end_date: '2026-03-24', cover_image_url: null, is_public: false, public_slug: null,
  destinations: [
    { id: 2 as unknown as string, trip_id: 3 as unknown as string, city_name: 'Kyoto', country: 'Japan', start_date: '2026-03-08', end_date: '2026-03-13', lat: '35.0116', lng: '135.7681', zoom_level: 12, order_index: 1,
      days: [{ id: 9 as unknown as string, date: '2026-03-09', label: null, color_hex: null, order_index: 0, activities: [
        { id: 2 as unknown as string, name: 'B', lat: null, lng: null, notes: null, is_optional: false, is_generic: false, maps_url: null, order_index: 1, time: null },
        { id: 1 as unknown as string, name: 'A', lat: '35', lng: '135', notes: null, is_optional: false, is_generic: false, maps_url: null, order_index: 0, time: null },
        { id: 3 as unknown as string, name: 'Area', lat: null, lng: null, notes: null, is_optional: false, is_generic: true, maps_url: null, order_index: 2, time: null },
      ] }] },
    { id: 1 as unknown as string, trip_id: 3 as unknown as string, city_name: 'Tokyo', country: 'Japan', start_date: '2026-02-22', end_date: '2026-03-01', lat: null, lng: null, zoom_level: null, order_index: 0, days: [] },
    { id: 4 as unknown as string, trip_id: 3 as unknown as string, city_name: ' tokyo ', country: 'Japan', start_date: null, end_date: null, lat: 35.6, lng: 139.7, zoom_level: 12, order_index: 2, days: [] },
  ],
});

describe('normalizeTrip / stops / summary / checklist', () => {
  it('stringifies ids, orders rows and gives every row a unique key', () => {
    const t = normalizeTrip(apiTrip());
    expect(t.id).toBe('3');
    expect(t.destinations.map((d) => d.city_name)).toEqual(['Tokyo', 'Kyoto', ' tokyo ']);
    expect(t.destinations[1]!.days[0]!.activities.map((a) => a.name)).toEqual(['A', 'B', 'Area']);
    expect(typeof t.destinations[0]!.id).toBe('string');
    const keys = t.destinations.flatMap((d) => [d._key, ...d.days.flatMap((x) => [x._key, ...x.activities.map((a) => a._key)])]);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('route stops are numbered, coloured and mark returns', () => {
    const stops = routeStops(normalizeTrip(apiTrip()));
    expect(stops.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(stops.map((s) => s.label)).toEqual(['Tokyo', 'Kyoto', 'tokyo (return)']);
    expect(stops[0]!.coords).toBeNull(); // no coordinates: listed, not mapped
    expect(stops[1]!.coords).toEqual([35.0116, 135.7681]);
    expect(stops[1]!.dates).toBe('8 Mar – 13 Mar');
    expect(stops[1]!.color).toBe(dayColor(1));
  });
  it('summary counts cities, days with places, places and unlocated non-generic places', () => {
    expect(tripSummary(normalizeTrip(apiTrip()))).toEqual({ cities: 3, days: 1, places: 3, unlocated: 1 });
  });
  it('checklist reflects what is missing', () => {
    const empty: ETrip = { ...normalizeTrip(apiTrip()), name: ' ', destinations: [], start_date: null };
    const items = Object.fromEntries(publishChecklist(empty).map((i) => [i.id, i]));
    expect(items.name!.done).toBe(false);
    expect(items.cities!.done).toBe(false);
    expect(items.places!.done).toBe(false);
    expect(items.dates!.optional).toBe(true);
    const full = Object.fromEntries(publishChecklist(normalizeTrip(apiTrip())).map((i) => [i.id, i]));
    expect(full.cities!.done && full.places!.done && full.name!.done && full.dates!.done).toBe(true);
    expect(full.located!.done).toBe(false);
    expect(full.located!.text).toMatch(/1 place without/);
  });
  it('temp ids', () => {
    const id = newTempId();
    expect(isTempId(id)).toBe(true);
    expect(isTempId('12')).toBe(false);
    expect(newTempId()).not.toBe(id);
  });
});
