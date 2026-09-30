import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initTheme, toggleTheme, getTheme } from '@/modules/theme';

function blockStorage(): void {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
}

describe('theme with unavailable localStorage', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => vi.restoreAllMocks());

  it('initTheme does not throw and applies a theme', () => {
    blockStorage();
    expect(() => initTheme()).not.toThrow();
    expect(['light', 'dark']).toContain(getTheme());
  });

  it('toggleTheme still switches the theme and emits theme-changed', () => {
    blockStorage();
    initTheme();
    const before = getTheme();
    const handler = vi.fn();
    window.addEventListener('theme-changed', handler);
    expect(() => toggleTheme()).not.toThrow();
    window.removeEventListener('theme-changed', handler);
    expect(getTheme()).not.toBe(before);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignores a corrupted saved value instead of applying it', () => {
    localStorage.setItem('theme', '"><script>');
    initTheme();
    expect(['light', 'dark']).toContain(getTheme());
    localStorage.clear();
  });
});
