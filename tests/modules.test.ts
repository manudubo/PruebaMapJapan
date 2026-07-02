import { describe, it, expect, beforeEach } from 'vitest';
import { getTheme, getThemeConfig, THEME_CONFIG } from '@/modules/theme';
import { calculateCountdown, validateTargetDate } from '@/modules/countdown';
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

  it('should return config for theme', () => {
    expect(getThemeConfig('light').tileUrl).toContain('light_all');
    expect(getThemeConfig('dark').tileUrl).toContain('dark_all');
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
// Countdown Tests
// ============================================

describe('Countdown Module', () => {
  const now = new Date(2026, 5, 1); // 2026-06-01, local time

  describe('calculateCountdown', () => {
    it('should compute days/hours/minutes/seconds remaining for a future date', () => {
      const target = new Date(2026, 5, 11); // 10 days ahead
      const result = calculateCountdown(target, now);
      expect(result.days).toBe(10);
      expect(result.total).toBeGreaterThan(0);
    });

    it('should return all zeros once the target is reached', () => {
      const target = new Date(2026, 4, 1); // in the past relative to `now`
      expect(calculateCountdown(target, now)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 });
    });
  });

  describe('validateTargetDate', () => {
    it('should accept today', () => {
      expect(validateTargetDate(new Date(2026, 5, 1), now).valid).toBe(true);
    });

    it('should accept a date within the next 3 years', () => {
      expect(validateTargetDate(new Date(2027, 0, 1), now).valid).toBe(true);
    });

    it('should reject a date before today', () => {
      const result = validateTargetDate(new Date(2026, 4, 30), now);
      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/ya pasó/);
    });

    it('should reject a date more than 3 years in the future', () => {
      const result = validateTargetDate(new Date(2029, 6, 2), now);
      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/Falta demasiado/);
    });

    it('should accept exactly 3 years ahead as the boundary', () => {
      expect(validateTargetDate(new Date(2029, 5, 1), now).valid).toBe(true);
    });
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
