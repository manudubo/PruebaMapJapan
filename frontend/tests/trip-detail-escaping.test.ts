import { describe, it, expect } from 'vitest';
import { buildCityCard, buildHotelPopup, buildLegendItem, buildPopup } from '@/pages/tripDetail';
import type { TripStop } from '@/modules/tripView';
import type { Activity, Day } from '@/types';

const XSS = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script><b>b</b> & "q"';
const day: Day = { label: XSS, color: '#ff3b30', activities: [] };
const el = (html: string): HTMLElement => Object.assign(document.createElement('div'), { innerHTML: html });

describe('popups show user text as text', () => {
  const activity: Activity = { name: XSS, coords: [1, 2], notes: XSS, optional: 'A', time: '09:00' };

  it('activity popup', () => {
    const root = el(buildPopup(activity, day, 'https://maps.example/x?a=1&b="2"'));
    expect(root.querySelector('img, script, b')).toBeNull();
    expect(root.querySelector('h4')?.textContent).toBe(XSS);
    expect(root.querySelector('p')?.textContent).toBe(XSS);
    expect(root.querySelector('.day-label')?.textContent).toContain(XSS);
    expect(root.querySelector('a.popup-link')?.getAttribute('href')).toBe('https://maps.example/x?a=1&b="2"');
  });

  it('hotel popup', () => {
    const root = el(buildHotelPopup({ name: XSS, coords: [1, 2] }, null));
    expect(root.querySelector('img, script, b')).toBeNull();
    expect(root.querySelector('h4')?.textContent).toBe(XSS);
  });

  it('legend item', () => {
    const item = buildLegendItem({ name: XSS, coords: undefined, notes: XSS }, 0, day);
    expect(item.querySelector('img, script, b')).toBeNull();
    expect(item.querySelector('strong')?.textContent).toBe(XSS);
    expect(item.querySelector('.legend-actions')).toBeNull(); // nothing to link to without coordinates
  });

  it('legend item with coordinates labels its icon links for screen readers', () => {
    const item = buildLegendItem({ name: 'Senso-ji', coords: [35.7, 139.8], notes: null }, 0, day);
    const labels = [...item.querySelectorAll('.legend-actions a')].map((a) => a.getAttribute('aria-label'));
    expect(labels).toEqual(['View Senso-ji on Google Maps', 'Directions to Senso-ji']);
  });
});

describe('buildCityCard', () => {
  const stop = (over: Partial<TripStop> = {}): TripStop => ({
    key: 'd1', index: 0, number: 1, name: 'Tokyo', label: 'Tokyo', dates: '2–3 Mar', coords: [1, 2],
    color: '#ff3b30', dayCount: 2, placeCount: 5, ...over,
  });

  it('is a link with the data-city hook the overview map syncs on', () => {
    const card = buildCityCard(stop(), 'trip.html?tripId=7&destIndex=0');
    expect(card.tagName).toBe('A');
    expect(card.getAttribute('href')).toBe('trip.html?tripId=7&destIndex=0');
    expect(card.dataset['city']).toBe('d1');
    expect(card.querySelector('small')?.textContent).toBe('2–3 Mar · 2 days · 5 places');
    expect(card.querySelector('.city-nopin')).toBeNull();
  });

  it('a city without a location says so and has a neutral marker', () => {
    const card = buildCityCard(stop({ coords: null }), '#');
    expect(card.querySelector('.city-nopin')?.textContent).toBe('No location yet');
    expect(card.querySelector('.city-marker')?.classList.contains('is-unlocated')).toBe(true);
  });

  it('a city with nothing planned and no dates still reads sensibly', () => {
    const card = buildCityCard(stop({ dates: '', dayCount: 0, placeCount: 0 }), '#');
    expect(card.querySelector('small')?.textContent).toBe('No dates yet');
  });

  it('city names are text', () => {
    const card = buildCityCard(stop({ label: XSS }), '#');
    expect(card.querySelector('img, script, b')).toBeNull();
    expect(card.querySelector('strong')?.textContent).toBe(XSS);
  });
});
