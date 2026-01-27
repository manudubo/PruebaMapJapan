import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCache,
  setCache,
  clearCache,
  createElement,
  cleanTitle,
  formatDate,
  truncate,
  isValidItem,
  debounce,
  createCalendarUrl,
  createDirectionsUrl,
  CACHE_DURATION
} from '@/modules/utils';

describe('Cache Functions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  it('should store and retrieve cache', () => {
    const testData = { foo: 'bar', count: 42 };
    setCache('test-key', testData);
    expect(getCache('test-key')).toEqual(testData);
  });

  it('should return null for missing cache', () => {
    expect(getCache('non-existent')).toBeNull();
  });

  it('should expire cache after duration', () => {
    setCache('expire-test', { value: 'test' });
    vi.advanceTimersByTime(CACHE_DURATION + 1000);
    expect(getCache('expire-test')).toBeNull();
  });

  it('should clear specific cache', () => {
    setCache('clear-test', { value: 'test' });
    expect(getCache('clear-test')).not.toBeNull();
    clearCache('clear-test');
    expect(getCache('clear-test')).toBeNull();
  });
});

describe('DOM Utilities', () => {
  it('should create element with class', () => {
    const el = createElement('div', 'test-class');
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('test-class');
  });

  it('should create element with HTML content', () => {
    const el = createElement('span', '', '<strong>Hello</strong>');
    expect(el.innerHTML).toBe('<strong>Hello</strong>');
  });
});

describe('String Utilities', () => {
  describe('cleanTitle', () => {
    it('should remove suffix after " - "', () => {
      expect(cleanTitle('Article Title - News Source')).toBe('Article Title');
    });

    it('should remove suffix after " | "', () => {
      expect(cleanTitle('Article Title | Publisher')).toBe('Article Title');
    });

    it('should handle titles without suffixes', () => {
      expect(cleanTitle('Simple Title')).toBe('Simple Title');
    });
  });

  describe('formatDate', () => {
    it('should format valid date string', () => {
      const result = formatDate('2026-02-22T10:00:00Z');
      expect(result).toMatch(/\d{1,2}/);
    });

    it('should return empty string for invalid date', () => {
      expect(formatDate('not-a-date')).toBe('');
    });

    it('should return empty string for empty input', () => {
      expect(formatDate('')).toBe('');
    });
  });

  describe('truncate', () => {
    it('should truncate long strings', () => {
      const result = truncate('This is a very long string', 15);
      expect(result).toBe('This is a ve...');
    });

    it('should not truncate short strings', () => {
      expect(truncate('Short', 10)).toBe('Short');
    });
  });
});

describe('Validation Functions', () => {
  it('should reject items with blacklisted domains', () => {
    const item = {
      title: 'Valid Title',
      link: 'https://tripadvisor.com/article',
      pubDate: '',
      source: ''
    };
    expect(isValidItem(item)).toBe(false);
  });

  it('should accept valid items', () => {
    const item = {
      title: 'Tokyo Festival',
      link: 'https://japantimes.co.jp/news/festival',
      pubDate: '',
      source: 'Japan Times'
    };
    expect(isValidItem(item)).toBe(true);
  });
});

describe('Function Utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should debounce function calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    debounced();
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('URL Utilities', () => {
  it('should create valid Calendar URL', () => {
    const url = createCalendarUrl('Event', 'https://example.com', 'Tokyo');
    expect(url).toContain('google.com/calendar/render');
    expect(url).toContain('text=Event');
  });

  it('should create valid Directions URL', () => {
    const url = createDirectionsUrl([35.6762, 139.7050]);
    expect(url).toContain('google.com/maps/dir');
    expect(url).toContain('destination=35.6762,139.705');
  });
});
