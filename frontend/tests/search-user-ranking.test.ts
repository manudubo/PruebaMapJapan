import { describe, it, expect, beforeAll } from 'vitest';
import {
  MAX_QUERY_LENGTH,
  buildSearchIndex,
  buildTripEntries,
  normalizeQuery,
  queryTerms,
  search,
  searchEntries,
} from '@/modules/search';
import type { SearchResult } from '@/modules/search';
import { mkTrip, sampleTrips } from './fixtures/searchTrips';

const all = (): SearchResult[] => sampleTrips().flatMap(buildTripEntries);

describe('buildTripEntries', () => {
  it('indexes the trip, its cities, hotels, days and activities', () => {
    const entries = buildTripEntries(sampleTrips()[0]!);
    const types = entries.map((e) => e.type);
    expect(types.filter((t) => t === 'trip')).toHaveLength(1);
    expect(types.filter((t) => t === 'city')).toHaveLength(2);
    expect(types.filter((t) => t === 'hotel')).toHaveLength(1);
    expect(types.filter((t) => t === 'day')).toHaveLength(2);
    expect(types.filter((t) => t === 'activity')).toHaveLength(3);
    expect(entries.every((e) => e.tripId === 't-spring')).toBe(true);
  });

  it('deep-links each level to the right trip page and section', () => {
    const byTitle = (t: string): SearchResult => buildTripEntries(sampleTrips()[0]!).find((e) => e.title === t)!;
    expect(byTitle('Spring in Kansai').url).toBe('trip.html?tripId=t-spring');
    expect(byTitle('Osaka').url).toBe('trip.html?tripId=t-spring&destIndex=1');
    const act = new URL(byTitle('Fushimi Inari').url, 'http://x/');
    expect(act.pathname).toBe('/trip.html');
    expect(Object.fromEntries(act.searchParams)).toEqual({
      tripId: 't-spring',
      destIndex: '0',
      day: '2026-04-01',
      activity: 'Fushimi Inari',
      activityId: 't-spring-d0-day0-a0',
    });
    const day = new URL(byTitle('Temples — Kyoto').url, 'http://x/');
    expect(day.searchParams.get('day')).toBe('2026-04-01');
    expect(day.searchParams.has('activity')).toBe(false);
  });

  it('destIndex follows order_index (what the trip page renders), not array position', () => {
    const trip = mkTrip({
      id: 7,
      name: 'Reordered',
      dests: [
        { city: 'Second', order: 1 },
        { city: 'First', order: 0 },
      ],
    });
    const entries = buildTripEntries(trip);
    expect(entries.find((e) => e.title === 'First')!.url).toContain('destIndex=0');
    expect(entries.find((e) => e.title === 'Second')!.url).toContain('destIndex=1');
  });

  it('repeated dates get the same date#id keys as the trip page', () => {
    const trip = mkTrip({
      id: 9,
      name: 'Twice',
      dests: [
        {
          city: 'Tokyo',
          days: [
            { date: '2026-05-01', label: 'Morning', order: 0 },
            { date: '2026-05-01', label: 'Evening', order: 1 },
          ],
        },
      ],
    });
    const days = buildTripEntries(trip).filter((e) => e.type === 'day');
    expect(days[0]!.date).toBe('2026-05-01');
    expect(days[1]!.date).toBe('2026-05-01#9-d0-day1');
  });

  it('skips generic activities, like the demo index', () => {
    const trip = mkTrip({
      id: 1,
      name: 'T',
      dests: [{ city: 'Kyoto', days: [{ date: '2026-01-01', acts: [{ name: 'Free time', generic: true }, 'Temple'] }] }],
    });
    expect(buildTripEntries(trip).filter((e) => e.type === 'activity').map((e) => e.title)).toEqual(['Temple']);
  });

  it('percent-encodes names with URL metacharacters so they cannot inject parameters', () => {
    const name = 'Ramen & Tea=1#frag?x=1';
    const trip = mkTrip({ id: 'a&b=c', name: 'T', dests: [{ city: 'Kyoto', days: [{ date: '2026-01-01', acts: [name] }] }] });
    const act = buildTripEntries(trip).find((e) => e.type === 'activity')!;
    const url = new URL(act.url, 'http://x/');
    expect(url.pathname).toBe('/trip.html');
    expect(url.hash).toBe('');
    expect(url.searchParams.get('activity')).toBe(name);
    expect(url.searchParams.get('tripId')).toBe('a&b=c');
    expect([...url.searchParams.keys()].sort()).toEqual(['activity', 'activityId', 'day', 'destIndex', 'tripId']);
  });

  it('copes with a bare list row (no destinations) and a trip without cities', () => {
    expect(buildTripEntries(mkTrip({ id: 1, name: 'Bare', bare: true }))).toHaveLength(1);
    const empty = buildTripEntries(mkTrip({ id: 2, name: 'Empty' }));
    expect(empty).toHaveLength(1);
    expect(empty[0]!.subtitle).toBe('');
  });

  it('adds "City · Trip" context to days and activities so hits are placeable among trips', () => {
    const act = all().find((e) => e.title === 'Snow festival')!;
    expect(act.context).toBe('Sapporo · Winter in Hokkaido');
  });
});

describe('searchEntries: ranking', () => {
  it('exact title beats prefix beats substring', () => {
    const entries = buildTripEntries(
      mkTrip({
        id: 1,
        name: 'Trip',
        dests: [{ city: 'Osaka Castle Park' }, { city: 'Osaka' }, { city: 'New Osaka' }],
      }),
    );
    expect(searchEntries(entries, 'osaka').map((r) => r.title)).toEqual(['Osaka', 'Osaka Castle Park', 'New Osaka']);
  });

  it('with identical text, type decides: trip, city, place, day, hotel', () => {
    const types = ['hotel', 'day', 'activity', 'city', 'trip'] as const;
    const entries: SearchResult[] = types.map((type) => ({ type, title: 'Kyoto', subtitle: '', city: '', cityKey: 'k', url: type }));
    expect(searchEntries(entries, 'kyoto').map((r) => r.type)).toEqual(['trip', 'city', 'activity', 'day', 'hotel']);
  });

  it('returns nothing when nothing matches (the type boost alone never makes a result)', () => {
    expect(searchEntries(all(), 'qqqqzzzz')).toEqual([]);
  });

  it('prefers the current trip, then lists other trips', () => {
    const results = searchEntries(all(), 'ramen', { currentTripId: 't-winter' });
    const ids = results.map((r) => r.tripId);
    expect(ids[0]).toBe('t-winter');
    expect(ids).toContain('t-spring');
    expect(ids.indexOf('t-spring')).toBeGreaterThan(ids.lastIndexOf('t-winter'));
  });

  it('without a current trip, score decides across trips', () => {
    const results = searchEntries(all(), 'ramen');
    expect(new Set(results.map((r) => r.tripId))).toEqual(new Set(['t-spring', 't-winter']));
  });

  it('keeps slots for other trips when the current trip has more matches than the limit', () => {
    const many = mkTrip({
      id: 'big',
      name: 'Big',
      dests: [{ city: 'Kyoto', days: [{ date: '2026-01-01', acts: Array.from({ length: 30 }, (_, i) => `Ramen ${i}`) }] }],
    });
    const other = mkTrip({
      id: 'small',
      name: 'Small',
      dests: [{ city: 'Osaka', days: [{ date: '2026-01-02', acts: ['Ramen A', 'Ramen B', 'Ramen C', 'Ramen D'] }] }],
    });
    const entries = [...buildTripEntries(many), ...buildTripEntries(other)];
    const results = searchEntries(entries, 'ramen', { limit: 8, currentTripId: 'big' });
    expect(results).toHaveLength(8);
    expect(results.filter((r) => r.tripId === 'small')).toHaveLength(3);
    expect(results.slice(0, 5).every((r) => r.tripId === 'big')).toBe(true);
  });

  it('a current trip with no matches does not hide the others', () => {
    const results = searchEntries(all(), 'snow', { currentTripId: 't-spring' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.tripId === 't-winter')).toBe(true);
  });

  it('respects the limit', () => {
    expect(searchEntries(all(), 'ramen', { limit: 2 })).toHaveLength(2);
    expect(searchEntries(all(), 'ramen', { limit: 2, currentTripId: 't-spring' })).toHaveLength(2);
  });

  it('is deterministic for equal scores (stable order)', () => {
    const a = searchEntries(all(), 'ramen').map((r) => r.url);
    const b = searchEntries(all(), 'ramen').map((r) => r.url);
    expect(a).toEqual(b);
  });
});

describe('queries: accents, unicode, metacharacters, length', () => {
  it('ignores accents in both the query and the data', () => {
    const entries = buildTripEntries(
      mkTrip({ id: 1, name: 'Viaje a Kōbe', dests: [{ city: 'Kōbe', days: [{ date: '2026-01-01', acts: ['Café Ñandú'] }] }] }),
    );
    expect(searchEntries(entries, 'kobe').length).toBeGreaterThan(0);
    expect(searchEntries(entries, 'KŌBE').length).toBeGreaterThan(0);
    expect(searchEntries(entries, 'cafe nandu')[0]!.title).toBe('Café Ñandú');
    expect(searchEntries(entries, 'café ñandú')[0]!.title).toBe('Café Ñandú');
  });

  it('finds Japanese text, including a single kanji', () => {
    const entries = buildTripEntries(mkTrip({ id: 1, name: 'T', dests: [{ city: '京都', days: [{ date: '2026-01-01', acts: ['清水寺'] }] }] }));
    expect(searchEntries(entries, '京都')[0]!.title).toBe('京都');
    expect(searchEntries(entries, '寺')[0]!.title).toBe('清水寺');
  });

  it('still ignores a single ASCII character (it would match everything)', () => {
    expect(queryTerms('a')).toEqual([]);
    expect(searchEntries(all(), 'a')).toEqual([]);
    expect(queryTerms('a b cc')).toEqual(['cc']);
  });

  it('treats regex metacharacters as literal text', () => {
    const entries = buildTripEntries(
      mkTrip({ id: 1, name: 'T', dests: [{ city: 'C++ (beta) [x] $1 ^ | \\ ? * .', days: [{ date: '2026-01-01', acts: ['a.b', 'axb'] }] }] }),
    );
    for (const q of ['.*', '(', '[', '\\', '+++', '?', '$^', '(?<=x)', '*']) {
      expect(() => searchEntries(entries, q)).not.toThrow();
    }
    expect(searchEntries(entries, 'a.b').map((r) => r.title)).toEqual(['a.b']);
    expect(searchEntries(entries, '.*')).toEqual([]);
    expect(searchEntries(entries, 'c++').length).toBeGreaterThan(0);
    expect(searchEntries(entries, '(beta)').length).toBeGreaterThan(0);
  });

  it('markup in a query is just text: it matches nothing and throws nothing', () => {
    expect(searchEntries(all(), '<img src=x onerror=alert(1)>')).toEqual([]);
    expect(searchEntries(all(), '"><script>alert(1)</script>')).toEqual([]);
  });

  it('markup in the data comes back untouched (escaping is the renderer\'s job)', () => {
    const payload = '<img src=x onerror=window.__pwned=1>';
    const entries = buildTripEntries(mkTrip({ id: 1, name: payload, dests: [] }));
    expect(searchEntries(entries, 'onerror')[0]!.title).toBe(payload);
  });

  it('caps very long queries and de-duplicates repeated terms', () => {
    const q = 'ramen '.repeat(2000);
    const t0 = performance.now();
    const results = searchEntries(all(), q);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(normalizeQuery(q).length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
    expect(queryTerms(q)).toEqual(['ramen']);
    expect(results.length).toBeGreaterThan(0);
  });

  it('bounds the number of distinct terms', () => {
    const q = Array.from({ length: 50 }, (_, i) => `term${i}`).join(' ');
    expect(queryTerms(q).length).toBeLessThanOrEqual(8);
  });

  it('empty and whitespace-only queries return nothing', () => {
    for (const q of ['', ' ', '\n\t  ']) expect(searchEntries(all(), q)).toEqual([]);
  });

  it('emoji and lone surrogates do not break matching', () => {
    const entries = buildTripEntries(mkTrip({ id: 1, name: 'Fun 🍜 trip', dests: [] }));
    expect(searchEntries(entries, '🍜')[0]!.title).toBe('Fun 🍜 trip');
    expect(() => searchEntries(entries, '\ud83d')).not.toThrow();
  });
});

describe('demo search keeps working and deep-links activities', () => {
  beforeAll(() => buildSearchIndex());

  it('activity results link to the city page with day and activity parameters', () => {
    const hit = search('Hikawa').find((r) => r.type === 'activity')!;
    const url = new URL(hit.url, 'http://x/');
    expect(url.pathname).toMatch(/\.html$/);
    expect(url.searchParams.get('day')).toBe(hit.date);
    expect(url.searchParams.get('activity')).toBe(hit.title);
  });

  it('non-activity results stay plain page links', () => {
    for (const r of search('Kyoto').filter((x) => x.type !== 'activity')) expect(r.url).toMatch(/^[a-z0-9]+\.html$/);
  });

  it('never returns user-scope entries', () => {
    expect(search('Kyoto').every((r) => r.tripId === undefined)).toBe(true);
  });
});
