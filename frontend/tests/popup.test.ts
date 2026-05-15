import { describe, it, expect } from 'vitest';
import { buildPopup, buildHotelPopup } from '@/pages/tripDetail';
import { createPopupContent, createHotelPopup } from '@/modules/map';

const XSS = '<script>alert(1)</script>';

describe('SEC-02 — tripDetail popup builders strip XSS', () => {
  it('buildPopup does not return a string containing <script>', () => {
    const activity = {
      name: XSS,
      notes: XSS,
      optional: null,
      type: 'activity',
      maps_url: null,
    } as any;
    const day = { label: XSS, color: '#fff', date: '2025-01-01' } as any;
    const result = buildPopup(activity, day, null);
    expect(result).not.toContain('<script>');
  });

  it('buildHotelPopup does not return a string containing <script>', () => {
    const hotel = { name: XSS, checkin: '2025-01-01', checkout: '2025-01-02' } as any;
    const day = { label: XSS, color: '#fff', date: '2025-01-01' } as any;
    const result = buildHotelPopup(hotel, day);
    expect(result).not.toContain('<script>');
  });
});

describe('SEC-02 — map popup builders strip XSS', () => {
  it('createPopupContent does not return a string containing <script>', () => {
    const activity = {
      name: XSS,
      notes: XSS,
      optional: XSS,
      type: 'activity',
      maps_url: null,
    } as any;
    const day = { label: XSS, color: '#fff', date: '2025-01-01' } as any;
    const result = createPopupContent(activity, day, null);
    expect(result).not.toContain('<script>');
  });

  it('createHotelPopup does not return a string containing <script>', () => {
    const hotel = { name: XSS, checkin: '2025-01-01', checkout: '2025-01-02' } as any;
    const day = { label: XSS, color: '#fff', date: '2025-01-01' } as any;
    const result = createHotelPopup(hotel, day);
    expect(result).not.toContain('<script>');
  });
});
