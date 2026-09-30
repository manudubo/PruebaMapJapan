import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initWidgets, renderList, safeHref } from '@/modules/widgets';
import { ITINERARY } from '@/data/itinerary';

// Drives initWidgets end to end with hostile / broken API responses.

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0));
};

function mountAndLoad(): void {
  document.body.innerHTML = '<div class="page-card"></div>';
  // Fire the IntersectionObserver callback immediately.
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
    observe(): void { this.cb([{ isIntersecting: true }]); }
    disconnect(): void { /* noop */ }
  });
  initWidgets('osaka');
}

const weatherKey = (): string => {
  const [lat, lon] = ITINERARY['osaka'].center;
  return `weather_${lat}_${lon}`;
};
const text = (sel: string): string => document.querySelector(sel)?.textContent ?? '';
const rssEnvelope = (items: { t: string; l: string }[]): string => JSON.stringify({
  contents: `<rss><channel>${items.map(i => `<item><title>${i.t}</title><link>${i.l}</link><pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate><source>S</source></item>`).join('')}</channel></rss>`,
});

describe('widgets with hostile or broken APIs', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

  it('shows "Weather unavailable" and does not cache a garbage weather payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('open-meteo')
        ? new Response('{"foo":1}', { status: 200 })
        : new Response('', { status: 500 })));
    mountAndLoad();
    await flush();
    expect(text('#widget-weather .widget-content')).toContain('Weather unavailable');
    expect(localStorage.getItem(weatherKey())).toBeNull();
    expect(document.querySelector('#widget-weather .widget-content')?.getAttribute('aria-busy')).toBe('false');
  });

  it('recovers from a corrupted cached weather entry instead of hanging on the loader', async () => {
    localStorage.setItem(weatherKey(), JSON.stringify({ data: { foo: 1 }, timestamp: Date.now() }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    mountAndLoad();
    await flush();
    expect(text('#widget-weather .widget-content')).toContain('Weather unavailable');
    expect(document.querySelector('#widget-weather .loader')).toBeNull();
    expect(localStorage.getItem(weatherKey())).toBeNull();
  });

  it('shows the empty/error state when both news proxies return non-JSON / non-XML', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('allorigins') ? new Response('<html>nope', { status: 200 })
        : url.includes('corsproxy') ? new Response('<<<not xml', { status: 200 })
          : new Response('', { status: 500 })));
    mountAndLoad();
    await flush();
    expect(text('#widget-news .widget-content')).toMatch(/No recent news|Reload/);
    expect(document.querySelector('#widget-news .loader')).toBeNull();
  });

  it('never turns javascript: or data: RSS links into hrefs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('allorigins')
        ? new Response(rssEnvelope([
          { t: 'Evil', l: 'javascript:alert(1)' },
          { t: 'Data', l: 'data:text/html,x' },
          { t: 'Good', l: 'https://example.com/a' },
        ]), { status: 200 })
        : new Response('', { status: 500 })));
    mountAndLoad();
    await flush();
    const hrefs = [...document.querySelectorAll('#widget-news a.widget-link')].map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://example.com/a']);
  });

  it('renderList (cached path) also drops unsafe links', () => {
    const c = document.createElement('div');
    renderList(c, [
      { title: 'x', link: 'JaVaScRiPt:alert(1)', pubDate: '', source: 's' },
      { title: 'y', link: ' https://ok.example/z ', pubDate: '', source: 's' },
    ], 'events', 'Osaka');
    expect([...c.querySelectorAll('a.widget-link')].map(a => a.getAttribute('href'))).toEqual(['https://ok.example/z']);
  });

  it('renders very long and RTL-override titles as inert text', () => {
    const c = document.createElement('div');
    const title = '‮evil <b>bold</b> ' + 'x'.repeat(5000);
    renderList(c, [{ title, link: 'https://e.example/', pubDate: 'not a date', source: '<i>src</i>' }], 'news', 'Osaka');
    expect(c.querySelector('b, i')).toBeNull();
    expect(c.querySelector('time')?.textContent).toBe('');
  });

  it('safeHref accepts only http(s)', () => {
    expect(safeHref('https://a.example/x?y=1')).toBe('https://a.example/x?y=1');
    expect(safeHref('http://a.example/')).toBe('http://a.example/');
    for (const bad of ['javascript:alert(1)', 'data:text/html,1', 'vbscript:x', '//a.example', 'not a url', '']) {
      expect(safeHref(bad)).toBeNull();
    }
  });
});
