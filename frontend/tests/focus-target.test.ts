import { describe, it, expect } from 'vitest';
import {
  cleanParam,
  findDestinationOfActivity,
  isEmptyRequest,
  markerIndexFor,
  normalizeName,
  resolveFocusTarget,
} from '@/modules/focusTarget';
import type { ApiDestination, CityData } from '@/types';

const act = (name: string, extra: Record<string, unknown> = {}) => ({ name, notes: null, coords: [35, 135] as [number, number], ...extra });

const data: CityData = {
  name: 'Tokyo',
  center: [35, 135],
  zoom: 12,
  hotel: { name: 'H', coords: undefined },
  dates: '',
  days: {
    '2031-05-01': {
      label: 'Day 1',
      color: '#f00',
      activities: [act('Ramen', { id: 'a1' }), act('Walk', { id: 'a2', coords: undefined }), act('Café Ü', { id: 'a3' })],
    },
    '2031-05-02': { label: 'Day 2', color: '#0f0', activities: [act('Ramen', { id: 'a4' }), act('Museum', { id: 'a5' })] },
    '2031-05-02#9': { label: 'Day 2b', color: '#00f', activities: [act('Ramen', { id: 'a6' })] },
  },
};

describe('cleanParam / isEmptyRequest', () => {
  it('trims, and treats blank, missing and absurdly long values as absent', () => {
    expect(cleanParam('  x ')).toBe('x');
    expect(cleanParam('')).toBeNull();
    expect(cleanParam('   ')).toBeNull();
    expect(cleanParam(null)).toBeNull();
    expect(cleanParam(undefined)).toBeNull();
    expect(cleanParam('a'.repeat(2001))).toBeNull();
    expect(cleanParam('a'.repeat(2000))).toHaveLength(2000);
  });

  it('knows an empty request', () => {
    expect(isEmptyRequest(null)).toBe(true);
    expect(isEmptyRequest({})).toBe(true);
    expect(isEmptyRequest({ day: ' ', activity: '' })).toBe(true);
    expect(isEmptyRequest({ activityId: 'a' })).toBe(false);
  });
});

describe('normalizeName', () => {
  it('folds case, whitespace and Unicode composition', () => {
    expect(normalizeName('  CAFÉ   Ü ')).toBe('café ü');
    expect(normalizeName('Café')).toBe(normalizeName('Café')); // e + combining acute vs é
  });
});

describe('resolveFocusTarget', () => {
  it('finds a name on its day', () => {
    expect(resolveFocusTarget(data, { day: '2031-05-02', activity: 'Museum' })).toEqual({ dayKey: '2031-05-02', activityIndex: 1 });
  });

  it('uses the day to tell duplicate names apart', () => {
    expect(resolveFocusTarget(data, { day: '2031-05-01', activity: 'Ramen' })).toEqual({ dayKey: '2031-05-01', activityIndex: 0 });
    expect(resolveFocusTarget(data, { day: '2031-05-02', activity: 'Ramen' })).toEqual({ dayKey: '2031-05-02', activityIndex: 0 });
    expect(resolveFocusTarget(data, { day: '2031-05-02#9', activity: 'Ramen' })).toEqual({ dayKey: '2031-05-02#9', activityIndex: 0 });
  });

  it('prefers the id over name and day', () => {
    expect(resolveFocusTarget(data, { day: '2031-05-02', activity: 'Ramen', activityId: 'a1' })).toEqual({
      dayKey: '2031-05-01',
      activityIndex: 0,
    });
  });

  it('falls back to the name when the id is unknown (renamed/deleted elsewhere)', () => {
    expect(resolveFocusTarget(data, { day: '2031-05-02', activity: 'Museum', activityId: 'gone' })).toEqual({
      dayKey: '2031-05-02',
      activityIndex: 1,
    });
  });

  it('searches every day when the day is missing or unknown, first match wins', () => {
    expect(resolveFocusTarget(data, { activity: 'Museum' })).toEqual({ dayKey: '2031-05-02', activityIndex: 1 });
    expect(resolveFocusTarget(data, { day: '1999-01-01', activity: 'Ramen' })).toEqual({ dayKey: '2031-05-01', activityIndex: 0 });
  });

  it('matches names ignoring case, spaces and Unicode form', () => {
    expect(resolveFocusTarget(data, { day: '2031-05-01', activity: ' café   ü ' })).toEqual({ dayKey: '2031-05-01', activityIndex: 2 });
  });

  it('resolves to the day alone for an unknown or absent activity', () => {
    expect(resolveFocusTarget(data, { day: '2031-05-02', activity: 'nope' })).toEqual({ dayKey: '2031-05-02', activityIndex: null });
    expect(resolveFocusTarget(data, { day: '2031-05-02' })).toEqual({ dayKey: '2031-05-02', activityIndex: null });
  });

  it('is null when nothing matches or the request is empty', () => {
    expect(resolveFocusTarget(data, { day: 'x', activity: 'y', activityId: 'z' })).toBeNull();
    expect(resolveFocusTarget(data, {})).toBeNull();
    expect(resolveFocusTarget(data, null)).toBeNull();
  });

  it('is not fooled by prototype keys as day names', () => {
    expect(resolveFocusTarget(data, { day: '__proto__' })).toBeNull();
    expect(resolveFocusTarget(data, { day: 'constructor', activity: 'nope' })).toBeNull();
  });

  it('handles a city without days', () => {
    expect(resolveFocusTarget({ ...data, days: {} }, { day: 'a', activity: 'b' })).toBeNull();
  });
});

describe('markerIndexFor', () => {
  it('counts only located activities before the target', () => {
    expect(markerIndexFor(data, '2031-05-01', 0)).toBe(0);
    expect(markerIndexFor(data, '2031-05-01', 2)).toBe(1); // "Walk" has no pin and no marker
  });
  it('is null for an activity without a pin or an unknown position', () => {
    expect(markerIndexFor(data, '2031-05-01', 1)).toBeNull();
    expect(markerIndexFor(data, '2031-05-01', 9)).toBeNull();
    expect(markerIndexFor(data, 'nope', 0)).toBeNull();
  });
});

describe('findDestinationOfActivity', () => {
  const dest = (id: string, ids: Array<string | number>): ApiDestination =>
    ({ id, days: [{ activities: ids.map((i) => ({ id: i })) }] }) as unknown as ApiDestination;
  const dests = [dest('d0', ['a', 'b']), dest('d1', [7, 'c'])];

  it('returns the position of the destination holding the id', () => {
    expect(findDestinationOfActivity(dests, 'c')).toBe(1);
    expect(findDestinationOfActivity(dests, '7')).toBe(1); // numeric ids from the API
    expect(findDestinationOfActivity(dests, 'a')).toBe(0);
  });
  it('is null for unknown, blank or missing ids and tolerates sparse data', () => {
    expect(findDestinationOfActivity(dests, 'zzz')).toBeNull();
    expect(findDestinationOfActivity(dests, '')).toBeNull();
    expect(findDestinationOfActivity(dests, null)).toBeNull();
    expect(findDestinationOfActivity([{ id: 'x' } as unknown as ApiDestination], 'a')).toBeNull();
  });
});
