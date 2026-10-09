/**
 * Export-level contract of "build the demo yourself": the demo itinerary is entered through the
 * editor's own store, the API payloads it sends (POST/PATCH/PUT destinations, days, hotel,
 * activities, reorder) are applied to a tiny in-memory backend, and the stored rows are read back
 * through tripAdapter into CityData — which must equal the demo's CityData.
 *
 * The browser half of this is tests/e2e/demo-parity.spec.ts; this one is the pure, fast layer and
 * also pins the edge cases a user can type (no coordinates, optional + generic, 255-char names,
 * kanji, markup).
 */
import { describe, it, expect } from 'vitest';
import { ITINERARY } from '@/data/itinerary';
import { EditorStore, type EditorApi } from '@/pages/trip-edit/store';
import { SaveQueue } from '@/pages/trip-edit/saveQueue';
import { apiDestinationToCityData, apiTripToCityData, optionLabel } from '@/modules/tripAdapter';
import type { ApiActivity, ApiDay, ApiDestination, ApiTrip, CityData } from '@/types';

type Body = Record<string, unknown>;
interface Call { fn: string; args: unknown[] }

/** The slice of the real API the editor talks to, with a database behind it. */
function fakeBackend() {
  let id = 100;
  const calls: Call[] = [];
  const dests: ApiDestination[] = [];
  const findDest = (d: string) => dests.find((x) => String(x.id) === d)!;
  const findDay = (d: string, day: string) => findDest(d).days.find((x) => String(x.id) === day)!;
  const rec = <A extends unknown[], R>(fn: string, run: (...a: A) => R) => async (...args: A): Promise<R> => { calls.push({ fn, args }); return run(...args); };

  const api = {
    updateTrip: rec('updateTrip', (_t: string, b: Body) => ({ id: 1, ...b })),
    createDestination: rec('createDestination', (_t: string, b: Body) => {
      const d = { id: id++, trip_id: 1, hotel: null, days: [], ...b } as unknown as ApiDestination;
      dests.push(d);
      return d;
    }),
    updateDestination: rec('updateDestination', (_t: string, d: string, b: Body) => Object.assign(findDest(d), b)),
    deleteDestination: rec('deleteDestination', () => undefined),
    createDay: rec('createDay', (_t: string, d: string, b: Body) => {
      const day = { id: id++, activities: [], ...b } as unknown as ApiDay;
      findDest(d).days.push(day);
      return day;
    }),
    updateDay: rec('updateDay', (_t: string, d: string, day: string, b: Body) => Object.assign(findDay(d, day), b)),
    deleteDay: rec('deleteDay', () => undefined),
    upsertHotel: rec('upsertHotel', (_t: string, d: string, b: Body) => {
      const dest = findDest(d);
      dest.hotel = { id: dest.hotel?.id ?? id++, ...b } as unknown as ApiDestination['hotel'];
      return dest.hotel;
    }),
    deleteHotel: rec('deleteHotel', () => undefined),
    createActivity: rec('createActivity', (_t: string, d: string, day: string, b: Body) => {
      const a = { id: id++, ...b } as unknown as ApiActivity;
      findDay(d, day).activities.push(a);
      return a;
    }),
    updateActivity: rec('updateActivity', (_t: string, d: string, day: string, a: string, b: Body) =>
      Object.assign(findDay(d, day).activities.find((x) => String(x.id) === a)!, b)),
    deleteActivity: rec('deleteActivity', () => undefined),
    reorderActivities: rec('reorderActivities', (_t: string, d: string, day: string, ids: unknown[]) => {
      const list = findDay(d, day).activities;
      ids.forEach((aid, i) => { const a = list.find((x) => String(x.id) === String(aid)); if (a) a.order_index = i; });
      return list;
    }),
  };
  const trip = (): ApiTrip => ({
    id: 1, user_id: 1, name: 'Japan 2026', description: null, start_date: null, end_date: null, cover_image_url: null,
    is_public: false, public_slug: null, destinations: JSON.parse(JSON.stringify(dests)),
  } as unknown as ApiTrip);
  return { api: api as unknown as EditorApi, calls, trip };
}

interface Stop { city: CityData; pin?: [number, number] }

/** Enter `stops` the way the editor UI does, wait for every save, and return the stored trip. */
async function enter(stops: Stop[]): Promise<{ stored: ApiTrip; calls: Call[] }> {
  const backend = fakeBackend();
  const store = new EditorStore(
    { id: '1', user_id: '1', name: 'Japan 2026', description: null, start_date: null, end_date: null, cover_image_url: null, is_public: false, public_slug: null, destinations: [] } as unknown as ApiTrip,
    backend.api,
    new SaveQueue({ retryDelaysMs: [] }),
    { debounceMs: 1 },
  );
  for (const { city, pin } of stops) {
    const at = pin ?? city.center;
    const dest = store.addDestination({ name: city.name, country: 'Japan', lat: at[0], lng: at[1] });
    const dates = Object.keys(city.days).sort();
    store.patchDestination(dest._key, { start_date: dates[0]!, end_date: dates[dates.length - 1]!, zoom_level: city.zoom }, true);
    store.setHotel(dest._key, { name: city.hotel.name, lat: city.hotel.coords?.[0] ?? null, lng: city.hotel.coords?.[1] ?? null });
    for (const [date, day] of Object.entries(city.days)) {
      let dayKey = '';
      for (const a of day.activities) {
        const act = store.addActivity(dest._key, date, { name: a.name, lat: a.coords?.[0] ?? null, lng: a.coords?.[1] ?? null })!;
        dayKey = store.dest(dest._key)!.days.find((d) => d.date === date)!._key;
        store.patchActivity(act._key, { notes: a.notes, is_optional: !!a.optional, is_generic: !!a.isGeneric }, true);
      }
      if (dayKey) store.patchDay(dayKey, { color_hex: day.color });
    }
  }
  await new Promise((r) => setTimeout(r, 20)); // debounced day patches
  await store.queue.idle();
  return { stored: backend.trip(), calls: backend.calls };
}

const years = (s: string): string => s.replace(/\b\d{4}\b/g, '').replace(/\D+/g, ' ').trim();

/** What a CityData has to carry to look the same (labels of alternatives are compared separately). */
function essence(c: CityData) {
  return {
    name: c.name,
    center: c.center,
    zoom: c.zoom,
    hotel: c.hotel,
    dates: years(c.dates),
    days: Object.entries(c.days).map(([date, d]) => ({
      date, label: d.label, color: d.color, hasOptions: !!d.hasOptions,
      activities: d.activities.map((a) => ({ name: a.name, coords: a.coords, notes: a.notes, optional: !!a.optional, isGeneric: !!a.isGeneric })),
    })),
  };
}

describe('the demo itinerary entered through the editor store and read back through tripAdapter', () => {
  const demo = Object.entries(ITINERARY);

  it('is sent as a complete, ordered set of API calls', async () => {
    const { calls } = await enter(demo.map(([, city]) => ({ city })));
    const count = (fn: string) => calls.filter((c) => c.fn === fn).length;
    expect(count('createDestination')).toBe(8);
    expect(count('upsertHotel')).toBe(8);
    expect(count('createDay')).toBe(demo.reduce((n, [, c]) => n + Object.keys(c.days).length, 0));
    expect(count('createActivity')).toBe(demo.reduce((n, [, c]) => n + Object.values(c.days).reduce((m, d) => m + d.activities.length, 0), 0));
    const order = calls.filter((c) => c.fn === 'createDestination').map((c) => (c.args[1] as { order_index: number }).order_index);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('every city comes back as the same CityData (dates, zoom, pin, hotel, days, colours, places, flags)', async () => {
    const { stored } = await enter(demo.map(([, city]) => ({ city })));
    const back = apiTripToCityData(stored);
    expect(back).toHaveLength(8);
    demo.forEach(([key, city], i) => {
      expect(essence(back[i]!), key).toEqual(essence(city));
    });
  });

  it('the alternatives come back labelled A, B, C per day (the demo\'s custom "1, 2, 3" is a known gap: the API stores only the flag)', async () => {
    const { stored } = await enter(demo.map(([, city]) => ({ city })));
    const takayama = apiTripToCityData(stored)[2]!;
    const labels = (date: string) => takayama.days[date]!.activities.map((a) => a.optional);
    expect(labels('2026-03-06')).toEqual(['A', 'B', 'C']); // the demo says the same
    expect(labels('2026-03-07')).toEqual(['A', 'B', 'C']); // the demo says 1, 2, 3
    expect(ITINERARY['takayama']!.days['2026-03-07']!.activities.map((a) => a.optional)).toEqual(['1', '2', '3']);
    expect(optionLabel(0)).toBe('A');
  });
});

describe('edge cases a user can type', () => {
  const one = (activities: CityData['days'][string]['activities'], over: Partial<CityData> = {}): Stop => ({
    city: {
      name: 'Test', center: [35, 135], zoom: 12, hotel: { name: 'Hotel', coords: [35.01, 135.01] }, dates: '',
      days: { '2026-04-01': { label: 'Wed 1', color: '#ff3b30', activities } }, ...over,
    },
  });
  const firstDay = (stored: ApiTrip): CityData['days'][string] => Object.values(apiDestinationToCityData(stored.destinations[0]!).days)[0]!;

  it('a place without coordinates is stored with null lat/lng and read back without coords', async () => {
    const { stored, calls } = await enter([one([{ name: 'Somewhere nice', coords: undefined as unknown as [number, number], notes: null }])]);
    expect(calls.find((c) => c.fn === 'createActivity')!.args[3]).toMatchObject({ name: 'Somewhere nice', lat: null, lng: null });
    expect(firstDay(stored).activities[0]).toMatchObject({ name: 'Somewhere nice', coords: undefined });
  });

  it('optional + generic together survive, and the alternative gets its letter', async () => {
    const { stored } = await enter([one([
      { name: 'Hike', coords: [35.1, 135.1], notes: null, optional: 'A' },
      { name: 'Free day', coords: [35.2, 135.2], notes: 'Explore', optional: 'B', isGeneric: true },
    ])]);
    const day = firstDay(stored);
    expect(day.hasOptions).toBe(true);
    expect(day.activities.map((a) => [a.name, a.optional, !!a.isGeneric])).toEqual([['Hike', 'A', false], ['Free day', 'B', true]]);
  });

  it('a 255-character name and a 255-character note round-trip unchanged', async () => {
    const name = 'N'.repeat(255);
    const notes = 'n'.repeat(255);
    const { stored } = await enter([one([{ name, coords: [35.1, 135.1], notes }])]);
    expect(firstDay(stored).activities[0]).toMatchObject({ name, notes });
  });

  it('kanji, kana, accents and emoji round-trip unchanged', async () => {
    const names = ['金閣寺', 'ラーメン横丁', 'Café Ōtsuka', 'Kōkyo 🏯', '伏見稲荷大社 (Fushimi Inari)'];
    const { stored } = await enter([one(names.map((name, i) => ({ name, coords: [35 + i / 100, 135] as [number, number], notes: name })))]);
    expect(firstDay(stored).activities.map((a) => a.name)).toEqual(names);
    expect(firstDay(stored).activities.map((a) => a.notes)).toEqual(names);
  });

  it('markup in names, notes and the hotel is stored and returned as plain text (the views escape it)', async () => {
    const xss = ['<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', "'; DROP TABLE trips;--", 'javascript:alert(1)'];
    const { stored } = await enter([one(
      xss.map((name, i) => ({ name, coords: [35 + i / 100, 135] as [number, number], notes: name })),
      { name: xss[0]!, hotel: { name: xss[1]!, coords: [35, 135] } },
    )]);
    const city = apiDestinationToCityData(stored.destinations[0]!);
    expect(city.name).toBe(xss[0]);
    expect(city.hotel.name).toBe(xss[1]);
    expect(Object.values(city.days)[0]!.activities.map((a) => a.name)).toEqual(xss);
    expect(Object.values(city.days)[0]!.activities.map((a) => a.notes)).toEqual(xss);
  });

  it('a hotel without coordinates is kept by name with no pin', async () => {
    const { stored } = await enter([one([{ name: 'A', coords: [35.1, 135.1], notes: null }], { hotel: { name: 'Ryokan', coords: undefined as unknown as [number, number] } })]);
    expect(apiDestinationToCityData(stored.destinations[0]!).hotel).toEqual({ name: 'Ryokan', coords: undefined });
  });
});
