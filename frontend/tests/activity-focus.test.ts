import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { selectDayAndFocusActivity, legendItemFor } from '@/modules/activityFocus';
import type { CityData } from '@/types';

const data: CityData = {
  name: 'Tokyo',
  center: [35, 135],
  zoom: 12,
  hotel: { name: 'H', coords: undefined },
  dates: '',
  days: {
    d1: {
      label: 'Day 1',
      color: '#f00',
      activities: [
        { id: 'a1', name: 'Ramen', notes: null, coords: [35.1, 139.1] },
        { id: 'a2', name: 'Walk', notes: null },
        { id: 'a3', name: 'Temple', notes: null, coords: [35.3, 139.3] },
      ],
    },
    d2: { label: 'Day 2', color: '#0f0', activities: [{ id: 'a4', name: 'Ramen', notes: null, coords: [35.2, 139.2] }] },
  },
};

function fixture() {
  document.body.innerHTML = `
    <div id="day-selector"><button class="day-btn" data-day="d1"></button><button class="day-btn" data-day="d2"></button></div>
    <div id="legend-grid">
      <div class="day-group" data-day="d1"><ul>
        <li class="legend-item" data-activity-index="0"></li><li class="legend-item" data-activity-index="1"></li><li class="legend-item" data-activity-index="2"></li>
      </ul></div>
      <div class="day-group" data-day="d2"><ul><li class="legend-item" data-activity-index="0"></li></ul></div>
    </div>`;
  const selector = document.getElementById('day-selector')!;
  const clicks: string[] = [];
  selector.querySelectorAll<HTMLElement>('.day-btn').forEach((b) => b.addEventListener('click', () => {
    clicks.push(b.dataset.day!);
    selector.querySelectorAll('.day-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
  }));
  const marker = () => ({ openPopup: vi.fn(), getLatLng: () => ({ lat: 1, lng: 2 }), addTo: vi.fn() });
  const markersByDay = { d1: [marker(), marker()], d2: [marker()] };
  const container = document.createElement('div');
  container.scrollIntoView = vi.fn();
  const map = { hasLayer: vi.fn(() => true), flyTo: vi.fn(), getContainer: () => container };
  return { selector, clicks, markersByDay, map };
}

const rows = (day: string) => Array.from(document.querySelectorAll<HTMLElement>(`.day-group[data-day="${day}"] .legend-item`));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('selectDayAndFocusActivity', () => {
  it('selects the day, opens the marker popup, flies there and highlights + focuses the row', () => {
    const f = fixture();
    const r = selectDayAndFocusActivity('d1', 'Temple', f.selector, f.map as never, data, f.markersByDay as never);
    expect(r).toEqual({ dayKey: 'd1', activityIndex: 2, onMap: true });
    expect(f.clicks).toEqual(['d1']);
    // "Walk" has no marker, so Temple is the second marker of the day, not the third
    expect(f.markersByDay.d1[1]!.openPopup).toHaveBeenCalledOnce();
    expect(f.markersByDay.d1[0]!.openPopup).not.toHaveBeenCalled();
    expect(f.map.flyTo).toHaveBeenCalledWith({ lat: 1, lng: 2 }, 15, expect.objectContaining({ duration: 0.8 }));
    expect(rows('d1')[2]!.classList.contains('is-focused')).toBe(true);
    expect(document.activeElement).toBe(rows('d1')[2]);
    expect(document.querySelector('[role="status"].sr-only')?.textContent).toBe('Temple, Day 1. Opened on the map.');
  });

  it('does not click an already active day (a second click would clear the filter)', () => {
    const f = fixture();
    f.selector.querySelector('[data-day="d1"]')!.classList.add('active');
    selectDayAndFocusActivity('d1', 'Ramen', f.selector, f.map as never, data, f.markersByDay as never);
    expect(f.clicks).toEqual([]);
    expect(f.markersByDay.d1[0]!.openPopup).toHaveBeenCalledOnce();
  });

  it('a day key with quotes or # is found without a CSS selector', () => {
    const f = fixture();
    const odd: CityData = { ...data, days: { 'a"b#1': data.days['d1']! } };
    f.selector.innerHTML = '<button class="day-btn" data-day=\'a"b#1\'></button>';
    const r = selectDayAndFocusActivity('a"b#1', 'Ramen', f.selector, f.map as never, odd, { 'a"b#1': f.markersByDay.d1 } as never);
    expect(r?.dayKey).toBe('a"b#1');
  });

  it('an activity without a pin: row focused and scrolled to, map untouched', () => {
    const f = fixture();
    const r = selectDayAndFocusActivity('d1', 'Walk', f.selector, f.map as never, data, f.markersByDay as never);
    expect(r).toEqual({ dayKey: 'd1', activityIndex: 1, onMap: false });
    expect(f.map.flyTo).not.toHaveBeenCalled();
    expect(f.markersByDay.d1.every((m) => m.openPopup.mock.calls.length === 0)).toBe(true);
    expect(rows('d1')[1]!.classList.contains('is-focused')).toBe(true);
    expect(rows('d1')[1]!.scrollIntoView).toHaveBeenCalled();
    expect(document.querySelector('[role="status"].sr-only')?.textContent).toContain('no location on the map');
  });

  it('works without a map (a city with no location at all)', () => {
    const f = fixture();
    const r = selectDayAndFocusActivity('d1', 'Ramen', null, null, data, {});
    expect(r).toEqual({ dayKey: 'd1', activityIndex: 0, onMap: false });
    expect(rows('d1')[0]!.classList.contains('is-focused')).toBe(true);
    expect(f.clicks).toEqual([]);
  });

  it('a day only: selects it, focuses nothing', () => {
    const f = fixture();
    const r = selectDayAndFocusActivity('d2', null, f.selector, f.map as never, data, f.markersByDay as never);
    expect(r).toEqual({ dayKey: 'd2', activityIndex: null, onMap: false });
    expect(f.clicks).toEqual(['d2']);
    expect(document.querySelector('.is-focused')).toBeNull();
    expect(f.map.flyTo).not.toHaveBeenCalled();
  });

  it('returns null and touches nothing for an unknown target', () => {
    const f = fixture();
    expect(selectDayAndFocusActivity('zz', 'nope', f.selector, f.map as never, data, f.markersByDay as never)).toBeNull();
    expect(f.clicks).toEqual([]);
  });

  it('moves the highlight from a previous focus', () => {
    const f = fixture();
    selectDayAndFocusActivity('d1', 'Ramen', f.selector, f.map as never, data, f.markersByDay as never);
    selectDayAndFocusActivity('d2', 'Ramen', f.selector, f.map as never, data, f.markersByDay as never);
    expect(document.querySelectorAll('.is-focused')).toHaveLength(1);
    expect(rows('d2')[0]!.classList.contains('is-focused')).toBe(true);
  });

  it('adds a marker that is not on the map yet before opening it', () => {
    const f = fixture();
    f.map.hasLayer.mockReturnValue(false);
    selectDayAndFocusActivity('d1', 'Ramen', f.selector, f.map as never, data, f.markersByDay as never);
    expect(f.markersByDay.d1[0]!.addTo).toHaveBeenCalledWith(f.map);
  });

  it('does not animate for reduced motion', () => {
    const f = fixture();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    selectDayAndFocusActivity('d1', 'Ramen', f.selector, f.map as never, data, f.markersByDay as never);
    expect(f.map.flyTo).toHaveBeenCalledWith(expect.anything(), 15, expect.objectContaining({ animate: false }));
  });
});

describe('legendItemFor', () => {
  it('is null when there is no legend or no such row', () => {
    document.body.innerHTML = '';
    expect(legendItemFor('d1', 0)).toBeNull();
    fixture();
    expect(legendItemFor('d1', 9)).toBeNull();
    expect(legendItemFor('nope', 0)).toBeNull();
    expect(legendItemFor('d2', 0)).toBe(rows('d2')[0]);
  });
});
