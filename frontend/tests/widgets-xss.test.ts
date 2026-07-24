import { describe, it, expect } from 'vitest';
import { renderList } from '@/modules/widgets';
import type { NewsItem } from '@/types';

// RED state: import fails until 20-02 adds `export` to renderList.
// The entire frontend suite exits non-zero until 20-02 is applied.
// Do not fix this file — fix widgets.ts in Plan 20-02.

const xssItem: NewsItem = {
  title: '<img src=x onerror=alert(1)>',
  link: 'https://example.com/news',
  pubDate: new Date().toISOString(),
  source: '<script>alert(2)</script>',
};

describe('renderList XSS prevention — SEC-02', () => {
  it('does not inject malicious title into the DOM as HTML', () => {
    const container = document.createElement('div');
    renderList(container, [xssItem], 'news', 'Tokyo');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('renders malicious title as literal text content', () => {
    const container = document.createElement('div');
    renderList(container, [xssItem], 'news', 'Tokyo');
    expect(container.textContent).toContain('<img src=x');
  });

  it('does not inject malicious source field as HTML', () => {
    const container = document.createElement('div');
    renderList(container, [xssItem], 'news', 'Tokyo');
    expect(container.textContent).toContain('<script>alert(2)</script>');
    expect(container.querySelector('script')).toBeNull();
  });

  it('events type: calendar URL assigned via setAttribute, not innerHTML', () => {
    const container = document.createElement('div');
    renderList(container, [xssItem], 'events', 'Tokyo');
    const calLink = container.querySelector('.calendar-btn') as HTMLAnchorElement | null;
    expect(calLink).not.toBeNull();
    expect(calLink?.getAttribute('href')).toBeTruthy();
    expect(calLink?.getAttribute('href')).not.toContain('<script>');
  });
});
