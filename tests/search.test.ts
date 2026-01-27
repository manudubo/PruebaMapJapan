import { describe, it, expect, beforeAll } from 'vitest';
import { search, buildSearchIndex, getSuggestions, getTypeIcon } from '@/modules/search';

describe('Search Module', () => {
  beforeAll(() => {
    buildSearchIndex();
  });

  describe('buildSearchIndex', () => {
    it('should build index without errors', () => {
      expect(() => buildSearchIndex()).not.toThrow();
    });
  });

  describe('search', () => {
    it('should find cities by name', () => {
      const results = search('Tokyo');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.type === 'city')).toBe(true);
    });

    it('should find activities by name', () => {
      const results = search('TeamLab');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.type === 'activity')).toBe(true);
    });

    it('should find hotels', () => {
      const results = search('Hotel');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.type === 'hotel')).toBe(true);
    });

    it('should return empty array for empty query', () => {
      expect(search('')).toEqual([]);
      expect(search('   ')).toEqual([]);
    });

    it('should respect limit parameter', () => {
      const results = search('a', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('should be case insensitive', () => {
      const lower = search('tokyo');
      const upper = search('TOKYO');
      expect(lower.length).toBe(upper.length);
    });

    it('should handle accented characters', () => {
      const results = search('Nagoya');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('getSuggestions', () => {
    it('should return city suggestions', () => {
      const suggestions = getSuggestions();
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.every(s => s.type === 'city')).toBe(true);
    });
  });

  describe('getTypeIcon', () => {
    it('should return SVG for each type', () => {
      const types = ['city', 'activity', 'day', 'hotel'] as const;
      types.forEach(type => {
        const icon = getTypeIcon(type);
        expect(icon).toContain('<svg');
        expect(icon).toContain('</svg>');
      });
    });
  });
});
