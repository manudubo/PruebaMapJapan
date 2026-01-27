import { describe, it, expect } from 'vitest';
import { cleanTitle, isValidItem, formatDate } from '../src/modules/utils';

describe('Utils Module', () => {
  describe('cleanTitle', () => {
    it('should remove media suffixes', () => {
      expect(cleanTitle('Tokyo Guide - CNN')).toBe('Tokyo Guide');
      expect(cleanTitle('Best Hotels | Travel Japan')).toBe('Best Hotels');
    });

    it('should remove date prefixes', () => {
      expect(cleanTitle('12/05/2025 Tokyo Update')).toBe('Tokyo Update');
    });
  });

  describe('isValidItem', () => {
    it('should filter blacklist domains', () => {
      const item = { title: 'Good News', link: 'https://www.tripadvisor.com/hotel' };
      expect(isValidItem(item, 'Tokyo')).toBe(false);
    });

    it('should allow valid news sources', () => {
      const item = { title: 'Festival Announced', link: 'https://www.japantimes.co.jp/news' };
      expect(isValidItem(item, 'Tokyo')).toBe(true);
    });
  });

  describe('formatDate', () => {
    it('should format valid dates correctly', () => {
      // Note: This depends on locale, checking partial match or mocking might be safer
      // but for this test we assume Spanish locale is active or default
      const date = '2026-03-15';
      const formatted = formatDate(date);
      expect(formatted).toMatch(/15/);
      expect(formatted).toMatch(/mar/i); 
    });

    it('should handle invalid dates', () => {
      expect(formatDate('invalid-date')).toBe('Fecha: N/A');
    });
  });
});