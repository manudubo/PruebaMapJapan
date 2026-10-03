import { describe, it, expect } from 'vitest';
import { buildPopup, buildLegendItem, resolveActivityMapsUrl } from '@/pages/tripDetail';
import { apiDayToDay } from '@/modules/tripAdapter';
import type { Activity, ApiActivity, Day } from '@/types';

const day: Day = { label: 'Sun 22', color: '#ff3b30', activities: [] };

function view(overrides: Partial<Activity> = {}): Activity {
  return { name: 'My custom place', coords: [35.1, 139.2], notes: null, ...overrides };
}

function popupDom(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

// ---------------------------------------------------------------------------
// BIZ-03 — which link "View on Maps" opens
// ---------------------------------------------------------------------------

describe('resolveActivityMapsUrl (BIZ-03)', () => {
  it('prefers the link saved in the editor', () => {
    expect(resolveActivityMapsUrl(view({ mapsUrl: 'https://maps.app.goo.gl/mine' }))).toBe('https://maps.app.goo.gl/mine');
  });

  it('prefers the saved link even over a demo-table name match', () => {
    expect(resolveActivityMapsUrl(view({ name: 'Minoh Falls', mapsUrl: 'https://example.com/x' }))).toBe(
      'https://example.com/x',
    );
  });

  it('falls back to the demo table for demo names', () => {
    expect(resolveActivityMapsUrl(view({ name: 'Minoh Falls' }))).toBe('https://maps.app.goo.gl/cRcu4xrQstb44Xdy5');
  });

  it('derives a pin search from coordinates for user-created activities', () => {
    expect(resolveActivityMapsUrl(view())).toBe('https://www.google.com/maps/search/?api=1&query=35.1,139.2');
  });

  it('is null with no link, no demo match and no coordinates', () => {
    expect(resolveActivityMapsUrl(view({ coords: undefined }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BIZ-03/04 — popup
// ---------------------------------------------------------------------------

describe('buildPopup shows time and the stored link (BIZ-03/04)', () => {
  it('renders the time next to the day label', () => {
    const el = popupDom(buildPopup(view({ time: '09:30' }), day, null));
    expect(el.querySelector('.day-label')?.textContent).toBe('Sun 22 · 09:30');
    expect(el.querySelector('time.popup-time')?.textContent).toBe('09:30');
  });

  it('has no time element when the activity has no time', () => {
    const el = popupDom(buildPopup(view(), day, null));
    expect(el.querySelector('.popup-time')).toBeNull();
    expect(el.querySelector('.day-label')?.textContent).toBe('Sun 22');
  });

  it('links to the stored maps_url', () => {
    const a = view({ mapsUrl: 'https://maps.app.goo.gl/mine' });
    const el = popupDom(buildPopup(a, day, resolveActivityMapsUrl(a)));
    expect(el.querySelector('a.popup-link')?.getAttribute('href')).toBe('https://maps.app.goo.gl/mine');
    expect(el.querySelector('a.directions')?.getAttribute('href')).toContain('destination=35.1,139.2');
  });

  it('hides map links for generic/area activities even with a stored link (BIZ-02)', () => {
    const a = view({ isGeneric: true, mapsUrl: 'https://maps.app.goo.gl/mine' });
    const el = popupDom(buildPopup(a, day, resolveActivityMapsUrl(a)));
    expect(el.querySelector('a')).toBeNull();
  });

  it('shows "Option B" with time for an optional activity', () => {
    const el = popupDom(buildPopup(view({ optional: 'B', time: '14:00' }), day, null));
    expect(el.querySelector('.day-label')?.textContent).toBe('Sun 22 · 14:00Option B');
    expect(el.querySelector('.optional-badge')?.textContent).toBe('Option B');
  });

  it('never emits a javascript: href even if one is passed in', () => {
    const html = buildPopup(view(), day, 'javascript:alert(1)');
    expect(html).not.toMatch(/javascript:/i);
  });
});

// ---------------------------------------------------------------------------
// BIZ-03/04 — legend
// ---------------------------------------------------------------------------

describe('buildLegendItem shows time and the stored link (BIZ-03/04)', () => {
  it('renders the time before the name', () => {
    const li = buildLegendItem(view({ time: '09:30' }), 0, day);
    const strong = li.querySelector('strong')!;
    expect(strong.querySelector('time.legend-time')?.textContent).toBe('09:30');
    expect(strong.querySelector('time')?.getAttribute('datetime')).toBe('09:30');
    expect(strong.textContent).toBe('09:30My custom place');
  });

  it('renders the name as text, never as markup', () => {
    const li = buildLegendItem(view({ name: '<img src=x onerror=alert(1)>', time: '09:30' }), 0, day);
    expect(li.querySelector('img')).toBeNull();
    expect(li.querySelector('strong')?.textContent).toContain('<img src=x');
  });

  it('uses the stored link, and a derived pin when there is none', () => {
    const stored = buildLegendItem(view({ mapsUrl: 'https://maps.app.goo.gl/mine' }), 0, day);
    expect(stored.querySelector('a.legend-action-btn')?.getAttribute('href')).toBe('https://maps.app.goo.gl/mine');
    const derived = buildLegendItem(view(), 0, day);
    expect(derived.querySelector('a.legend-action-btn')?.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=35.1,139.2',
    );
  });

  it('no links for an activity without coordinates', () => {
    const li = buildLegendItem(view({ coords: undefined, mapsUrl: 'https://maps.app.goo.gl/mine' }), 0, day);
    expect(li.querySelector('a')).toBeNull();
  });

  it('marks optional activities with their letter and the optional style (BIZ-01)', () => {
    const li = buildLegendItem(view({ optional: 'C' }), 4, day);
    expect(li.classList.contains('is-optional')).toBe(true);
    expect(li.querySelector('.legend-marker')?.textContent).toBe('C');
  });
});

// ---------------------------------------------------------------------------
// API → adapter → legend: a stored javascript: link never becomes an href
// ---------------------------------------------------------------------------

describe('API row → view (combined)', () => {
  const row = (overrides: Partial<ApiActivity>): ApiActivity => ({
    id: '1', name: 'Place', lat: '35.1', lng: '139.2', notes: null, is_optional: false,
    is_generic: false, maps_url: null, order_index: 0, time: null, ...overrides,
  });

  it('legacy javascript: maps_url in the DB falls back to the derived pin', () => {
    const d = apiDayToDay({
      id: '1', date: '2026-02-22', label: 'Sun 22', color_hex: '#ff3b30', order_index: 0,
      activities: [row({ maps_url: 'javascript:alert(document.cookie)' })],
    });
    const li = buildLegendItem(d.activities[0], 0, d);
    const hrefs = Array.from(li.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs.some((h) => /javascript:/i.test(h ?? ''))).toBe(false);
    expect(hrefs[0]).toBe('https://www.google.com/maps/search/?api=1&query=35.1,139.2');
  });

  it('optional + generic + time + link survive to the legend', () => {
    const d = apiDayToDay({
      id: '1', date: '2026-02-22', label: null, color_hex: null, order_index: 0,
      activities: [
        row({ id: '1', name: 'Fixed', time: '08:00' }),
        row({ id: '2', name: 'Area', order_index: 1, is_optional: true, is_generic: true, time: '10:00',
              maps_url: 'https://example.com/area' }),
        row({ id: '3', name: 'Alt', order_index: 2, is_optional: true, maps_url: 'https://example.com/alt' }),
      ],
    });
    const items = d.activities.map((a, i) => buildLegendItem(a, i, d));
    expect(items.map((li) => li.querySelector('.legend-marker')?.textContent)).toEqual(['1', 'A', 'B']);
    expect(items[0].querySelector('.legend-time')?.textContent).toBe('08:00');
    expect(items[1].querySelector('.legend-time')?.textContent).toBe('10:00');
    expect(items[1].querySelector('a')).toBeNull(); // generic: no pin link
    expect(items[2].querySelector('a.legend-action-btn')?.getAttribute('href')).toBe('https://example.com/alt');
  });
});
