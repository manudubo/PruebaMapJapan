import { describe, it, expect } from 'vitest';
import {
  apiDestinationToCityData,
  apiActivityToActivity,
  apiDayToDay,
  apiTripToCityData,
  toCoords,
  safeHttpUrl,
  optionLabel,
  DEFAULT_ZOOM,
} from '@/modules/tripAdapter';
import type { ApiActivity, ApiDay, ApiDestination, ApiTrip } from '@/types';

function dest(overrides: Partial<ApiDestination> = {}): ApiDestination {
  return {
    id: '1',
    trip_id: '1',
    city_name: 'Tokyo',
    country: 'Japan',
    start_date: null,
    end_date: null,
    lat: 35.68,
    lng: 139.76,
    zoom_level: 12,
    order_index: 0,
    days: [],
    ...overrides,
  };
}

function act(overrides: Partial<ApiActivity> = {}): ApiActivity {
  return {
    id: '1',
    name: 'Senso-ji',
    lat: '35.7148000',
    lng: '139.7967000',
    notes: null,
    is_optional: false,
    is_generic: false,
    maps_url: null,
    order_index: 0,
    time: null,
    ...overrides,
  };
}

function day(overrides: Partial<ApiDay> = {}): ApiDay {
  return {
    id: '10',
    date: '2026-02-22',
    label: 'Sun 22',
    color_hex: '#ff3b30',
    order_index: 0,
    activities: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// BIZ-10 — date-range label is English and handles partial dates
// ---------------------------------------------------------------------------

describe('destination date-range label (BIZ-10)', () => {
  it.each([
    ['both dates', '2026-02-22', '2026-03-01', 'Feb 22, 2026 – Mar 1, 2026'],
    ['equal dates', '2026-02-22', '2026-02-22', 'Feb 22, 2026 – Feb 22, 2026'],
    ['start only', '2026-02-22', null, 'From Feb 22, 2026'],
    ['end only', null, '2026-03-01', 'Until Mar 1, 2026'],
    ['no dates', null, null, ''],
  ])('%s → %j', (_label, start_date, end_date, expected) => {
    expect(apiDestinationToCityData(dest({ start_date, end_date })).dates).toBe(expected);
  });

  it('never emits the old Spanish words', () => {
    const labels = [
      apiDestinationToCityData(dest({ start_date: '2026-02-22' })).dates,
      apiDestinationToCityData(dest({ end_date: '2026-02-22' })).dates,
    ];
    for (const label of labels) expect(label).not.toMatch(/Desde|Hasta/);
  });
});

// ---------------------------------------------------------------------------
// Coordinates: API NUMERIC strings / nulls → Leaflet pairs
// ---------------------------------------------------------------------------

describe('toCoords', () => {
  it.each([
    ['NUMERIC strings', '35.7148000', '139.7967000', [35.7148, 139.7967]],
    ['numbers', 35.7, 139.8, [35.7, 139.8]],
    ['bounds', -90, 180, [-90, 180]],
    ['zero is a real coordinate', 0, 0, [0, 0]],
    ['mixed', '0', 0, [0, 0]],
  ])('%s', (_l, lat, lng, expected) => {
    expect(toCoords(lat, lng)).toEqual(expected);
  });

  it.each([
    ['null lat', null, 139],
    ['null lng', 35, null],
    ['both null', null, null],
    ['undefined', undefined, undefined],
    ['empty strings', '', ''],
    ['blank string', '  ', '139'],
    ['"null" string', 'null', 'null'],
    ['"NaN" string', 'NaN', '139'],
    ['garbage', 'abc', '139'],
    ['lat out of range', 90.5, 0],
    ['lng out of range', 0, -180.5],
    ['Infinity', Infinity, 0],
  ])('%s → undefined (no pin at 0,0)', (_l, lat, lng) => {
    expect(toCoords(lat as never, lng as never)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// BIZ-01/02/03/04 — activity fields reach the view
// ---------------------------------------------------------------------------

describe('apiActivityToActivity (BIZ-01..04)', () => {
  it('maps a plain activity', () => {
    expect(apiActivityToActivity(act())).toEqual({
      id: '1',
      name: 'Senso-ji',
      coords: [35.7148, 139.7967],
      notes: null,
      optional: undefined,
      isGeneric: false,
    });
  });

  it('maps time (BIZ-04) and maps_url (BIZ-03)', () => {
    const view = apiActivityToActivity(act({ time: '09:30', maps_url: 'https://maps.app.goo.gl/abc' }));
    expect(view.time).toBe('09:30');
    expect(view.mapsUrl).toBe('https://maps.app.goo.gl/abc');
  });

  it('omits empty time / maps_url instead of carrying nulls', () => {
    const view = apiActivityToActivity(act({ time: null, maps_url: null }));
    expect('time' in view).toBe(false);
    expect('mapsUrl' in view).toBe(false);
    const blank = apiActivityToActivity(act({ time: '', maps_url: '' }));
    expect('time' in blank).toBe(false);
    expect('mapsUrl' in blank).toBe(false);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'not a url',
    '/relative/path',
  ])('drops unsafe stored maps_url %j', (maps_url) => {
    expect(apiActivityToActivity(act({ maps_url })).mapsUrl).toBeUndefined();
  });

  it('maps is_generic (BIZ-02)', () => {
    expect(apiActivityToActivity(act({ is_generic: true })).isGeneric).toBe(true);
  });

  it('labels a standalone optional activity "A" and accepts an explicit label (BIZ-01)', () => {
    expect(apiActivityToActivity(act({ is_optional: true })).optional).toBe('A');
    expect(apiActivityToActivity(act({ is_optional: true }), 'C').optional).toBe('C');
    expect(apiActivityToActivity(act({ is_optional: false }), 'C').optional).toBeUndefined();
  });

  it('has no coords when the activity has none', () => {
    expect(apiActivityToActivity(act({ lat: null, lng: null })).coords).toBeUndefined();
  });

  it('keeps every field for an optional + generic activity with time and link', () => {
    const view = apiActivityToActivity(
      act({ is_optional: true, is_generic: true, time: '14:00', maps_url: 'https://example.com/m', notes: 'n' }),
      'B',
    );
    expect(view).toEqual({
      id: '1',
      name: 'Senso-ji',
      coords: [35.7148, 139.7967],
      notes: 'n',
      optional: 'B',
      isGeneric: true,
      time: '14:00',
      mapsUrl: 'https://example.com/m',
    });
  });
});

describe('safeHttpUrl / optionLabel', () => {
  it('safeHttpUrl', () => {
    expect(safeHttpUrl('https://a.b/c?d=1')).toBe('https://a.b/c?d=1');
    expect(safeHttpUrl('http://a.b')).toBe('http://a.b');
    expect(safeHttpUrl('JAVASCRIPT:alert(1)')).toBeUndefined();
    expect(safeHttpUrl(' javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl(null)).toBeUndefined();
    expect(safeHttpUrl(undefined)).toBeUndefined();
  });

  it('optionLabel', () => {
    expect([0, 1, 2, 25].map(optionLabel)).toEqual(['A', 'B', 'C', 'Z']);
    expect(optionLabel(26)).toBe('27');
  });
});

// ---------------------------------------------------------------------------
// BIZ-01 — optional labels per day (replaces the phantom optional_label)
// ---------------------------------------------------------------------------

describe('apiDayToDay optional labels (BIZ-01)', () => {
  it('labels optional activities A, B, C in order_index order, skipping required ones', () => {
    const d = apiDayToDay(
      day({
        activities: [
          act({ id: '3', name: 'third', order_index: 3, is_optional: true }),
          act({ id: '1', name: 'first', order_index: 1, is_optional: true }),
          act({ id: '0', name: 'fixed', order_index: 0 }),
          act({ id: '2', name: 'second', order_index: 2, is_optional: true }),
        ],
      }),
    );
    expect(d.activities.map((a) => [a.name, a.optional])).toEqual([
      ['fixed', undefined],
      ['first', 'A'],
      ['second', 'B'],
      ['third', 'C'],
    ]);
    expect(d.hasOptions).toBe(true);
  });

  it('hasOptions is undefined when nothing is optional', () => {
    expect(apiDayToDay(day({ activities: [act()] })).hasOptions).toBeUndefined();
    expect(apiDayToDay(day({ activities: [] })).hasOptions).toBeUndefined();
  });

  it('falls back to a demo-style label and a default colour for days saved without them', () => {
    const d = apiDayToDay(day({ label: null, color_hex: null }));
    expect(d.label).toBe('Sun 22');
    expect(d.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('ignores a stray optional_label from old payloads', () => {
    const withPhantom = { ...act({ is_optional: true }), optional_label: 'Z' } as ApiActivity;
    expect(apiDayToDay(day({ activities: [withPhantom] })).activities[0].optional).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// BIZ-05 — zoom, centre and day ordering
// ---------------------------------------------------------------------------

describe('apiDestinationToCityData centre / zoom (BIZ-05)', () => {
  it('uses the stored zoom_level', () => {
    expect(apiDestinationToCityData(dest({ zoom_level: 15 })).zoom).toBe(15);
    expect(apiDestinationToCityData(dest({ zoom_level: 1 })).zoom).toBe(1);
  });

  it('falls back to the default zoom when zoom_level is null', () => {
    expect(apiDestinationToCityData(dest({ zoom_level: null })).zoom).toBe(DEFAULT_ZOOM);
  });

  it('parses NUMERIC-string centre coordinates', () => {
    expect(apiDestinationToCityData(dest({ lat: '35.6762000', lng: '139.6503000' })).center).toEqual([
      35.6762, 139.6503,
    ]);
  });

  it('centres on the hotel, then the first located activity, then the world', () => {
    const hotel = { id: 'h', name: 'H', lat: '35.1', lng: '139.1', check_in_date: null, check_out_date: null, url: null };
    expect(apiDestinationToCityData(dest({ lat: null, lng: null, hotel })).center).toEqual([35.1, 139.1]);

    const withActivity = dest({
      lat: null,
      lng: null,
      days: [
        day({
          activities: [act({ lat: null, lng: null }), act({ id: '2', lat: '34.9', lng: '135.7', order_index: 1 })],
        }),
      ],
    });
    expect(apiDestinationToCityData(withActivity).center).toEqual([34.9, 135.7]);

    const nothing = apiDestinationToCityData(dest({ lat: null, lng: null, zoom_level: 15 }));
    expect(nothing.center).toEqual([20, 0]);
    expect(nothing.zoom).toBe(2); // world view, not zoom 15 on the Atlantic
  });

  it('hotel placeholder has no coords when the destination has none', () => {
    expect(apiDestinationToCityData(dest({ lat: null, lng: null })).hotel.coords).toBeUndefined();
  });

  it('orders days by date even when order_index ties (generated days)', () => {
    const cd = apiDestinationToCityData(
      dest({
        days: [
          day({ id: 'c', date: '2026-02-24', order_index: 0 }),
          day({ id: 'a', date: '2026-02-22', order_index: 0 }),
          day({ id: 'b', date: '2026-02-23', order_index: 0 }),
        ],
      }),
    );
    expect(Object.keys(cd.days)).toEqual(['2026-02-22', '2026-02-23', '2026-02-24']);
  });

  it('keeps both days when two share a date', () => {
    const cd = apiDestinationToCityData(
      dest({ days: [day({ id: 'x', label: 'Morning' }), day({ id: 'y', label: 'Evening', order_index: 1 })] }),
    );
    expect(Object.keys(cd.days)).toEqual(['2026-02-22', '2026-02-22#y']);
    expect(Object.values(cd.days).map((d) => d.label)).toEqual(['Morning', 'Evening']);
  });
});

// ---------------------------------------------------------------------------
// Combination: a full trip with partial dates
// ---------------------------------------------------------------------------

describe('full trip round-trip (combined)', () => {
  it('optional + generic activity with time and maps_url in a partial-date trip', () => {
    const trip: ApiTrip = {
      id: '1',
      user_id: '1',
      name: 'Partial',
      description: null,
      start_date: '2026-02-22',
      end_date: null,
      cover_image_url: null,
      is_public: true,
      public_slug: null,
      destinations: [
        dest({
          id: 'd2',
          city_name: 'Kyoto',
          order_index: 1,
          start_date: null,
          end_date: '2026-03-01',
          zoom_level: 14,
          lat: '35.0116',
          lng: '135.7681',
          days: [
            day({
              date: '2026-02-28',
              label: null,
              activities: [
                act({
                  name: 'Arashiyama area',
                  is_optional: true,
                  is_generic: true,
                  time: '08:00',
                  maps_url: 'https://maps.google.com/?q=Arashiyama',
                  lat: '35.0094',
                  lng: '135.6668',
                }),
                act({ id: '2', name: 'Kinkaku-ji', order_index: 1, is_optional: true, time: '13:15' }),
              ],
            }),
          ],
        }),
        dest({ id: 'd1', city_name: 'Tokyo', order_index: 0, start_date: '2026-02-22' }),
      ],
    };
    const [tokyo, kyoto] = apiTripToCityData(trip);
    expect(tokyo.name).toBe('Tokyo');
    expect(tokyo.dates).toBe('From Feb 22, 2026');
    expect(kyoto.dates).toBe('Until Mar 1, 2026');
    expect(kyoto.zoom).toBe(14);
    const kDay = kyoto.days['2026-02-28'];
    expect(kDay.label).toBe('Sat 28');
    expect(kDay.hasOptions).toBe(true);
    expect(kDay.activities).toEqual([
      {
        id: '1',
        name: 'Arashiyama area',
        coords: [35.0094, 135.6668],
        notes: null,
        optional: 'A',
        isGeneric: true,
        time: '08:00',
        mapsUrl: 'https://maps.google.com/?q=Arashiyama',
      },
      {
        id: '2',
        name: 'Kinkaku-ji',
        coords: [35.7148, 139.7967],
        notes: null,
        optional: 'B',
        isGeneric: false,
        time: '13:15',
      },
    ]);
  });
});
