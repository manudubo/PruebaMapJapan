import { describe, it, expect } from 'vitest';
import { apiDestinationToCityData } from '@/modules/tripAdapter';
import type { ApiDestination } from '@/types';

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
