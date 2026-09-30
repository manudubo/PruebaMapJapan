import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@/components/SearchBar';
import { extendSearchIndexWithApiTrip } from '@/modules/search';
import { escapeHtml } from '@/modules/utils';
import type { ApiTrip } from '@/types';

const PAYLOAD = '<img src=x onerror=window.__pwned=1>';

function makeTrip(): ApiTrip {
  return {
    id: 'xss-trip', user_id: 'u', name: PAYLOAD, description: null,
    start_date: null, end_date: null, cover_image_url: null, is_public: false, public_slug: null,
    destinations: [{
      id: 'd1', city_name: `Zzq ${PAYLOAD}`, start_date: null, end_date: null,
      hotel: null,
      days: [{
        date: '2026-03-01', label: 'Day',
        activities: [{ id: 'a1', name: `Zzq activity ${PAYLOAD}`, notes: `Zzq note ${PAYLOAD}`, lat: null, lng: null }],
      }],
    }],
  } as unknown as ApiTrip;
}

describe('SearchBar escapes API-sourced text (stored XSS guard)', () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ''; });
  afterEach(() => { vi.useRealTimers(); });

  it('renders trip names, activity names and notes as inert text', () => {
    const bar = document.createElement('search-bar');
    document.body.appendChild(bar);
    extendSearchIndexWithApiTrip(makeTrip());

    const input = bar.shadowRoot!.querySelector('input') as HTMLInputElement;
    input.value = 'zzq';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(400);

    const list = bar.shadowRoot!.querySelector('.search-results')!;
    expect(list.querySelectorAll('.search-result').length).toBeGreaterThan(0);
    expect(list.querySelector('img')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    // The payload is visible as literal text, proving it was escaped rather than dropped.
    expect(list.textContent).toContain('<img src=x');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
});
