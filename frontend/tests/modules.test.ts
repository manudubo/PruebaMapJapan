import { describe, it, expect, beforeEach } from 'vitest';
import { getTheme, getThemeConfig, THEME_CONFIG } from '@/modules/theme';
import { ITINERARY } from '@/data/itinerary';
import { getMapsUrl, hasMapsUrl } from '@/data/maps';

// ============================================
// Theme Tests
// ============================================

describe('Theme Module', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
  });

  it('should return light as default', () => {
    expect(getTheme()).toBe('light');
  });

  it('should return theme from document attribute', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(getTheme()).toBe('dark');
  });

  it('should return config for theme (both themes share the keyless OSM tiles)', () => {
    expect(getThemeConfig('light').tileUrl).toContain('tile.openstreetmap.org');
    expect(getThemeConfig('dark').tileUrl).toBe(getThemeConfig('light').tileUrl);
  });

  it('should have valid tile URLs', () => {
    expect(THEME_CONFIG.light.tileUrl).toMatch(/^https:\/\//);
    expect(THEME_CONFIG.dark.tileUrl).toMatch(/^https:\/\//);
  });

  it('should have valid route colors', () => {
    expect(THEME_CONFIG.light.routeColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(THEME_CONFIG.dark.routeColor).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

// ============================================
// Itinerary Data Tests
// ============================================

describe('Itinerary Data', () => {
  const expectedCities = ['tokyo', 'nagoya', 'takayama', 'kyoto', 'osaka', 'naoshima', 'hakone', 'tokyo2'];

  it('should have all expected cities', () => {
    expectedCities.forEach(city => {
      expect(ITINERARY).toHaveProperty(city);
    });
  });

  expectedCities.forEach(cityKey => {
    describe(cityKey, () => {
      const city = ITINERARY[cityKey];

      it('should have required properties', () => {
        expect(city.name).toBeDefined();
        expect(city.center).toHaveLength(2);
        expect(city.zoom).toBeGreaterThan(0);
        expect(city.hotel).toBeDefined();
        expect(city.dates).toBeDefined();
      });

      it('should have valid coordinates', () => {
        expect(city.center[0]).toBeGreaterThanOrEqual(30);
        expect(city.center[0]).toBeLessThanOrEqual(45);
        expect(city.center[1]).toBeGreaterThanOrEqual(128);
        expect(city.center[1]).toBeLessThanOrEqual(146);
      });

      it('should have days with activities', () => {
        expect(Object.keys(city.days).length).toBeGreaterThan(0);
        Object.values(city.days).forEach(day => {
          expect(day.label).toBeDefined();
          expect(day.color).toMatch(/^#[0-9a-f]{6}$/i);
          expect(day.activities.length).toBeGreaterThan(0);
        });
      });
    });
  });
});

// ============================================
// Maps Data Tests
// ============================================

describe('Maps Data', () => {
  it('should return URL for known locations', () => {
    const url = getMapsUrl('TeamLab Planets');
    expect(url).toBeDefined();
    expect(url).toContain('maps.app.goo.gl');
  });

  it('should return null for unknown locations', () => {
    expect(getMapsUrl('Unknown Location XYZ')).toBeNull();
  });

  it('should check URL existence correctly', () => {
    expect(hasMapsUrl('Ghibli Park')).toBe(true);
    expect(hasMapsUrl('Random Place')).toBe(false);
  });
});
