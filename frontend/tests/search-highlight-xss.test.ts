import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SearchResult } from '@/modules/search';

// SEC-10: search result rendering must not parse result text or the query as
// HTML. Today results come from static ITINERARY data; once the index holds
// API data (user-editable trip/activity names) this is the XSS boundary.

const mocked = vi.hoisted(() => ({ results: [] as SearchResult[] }));
vi.mock('@/modules/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/search')>();
  return { ...actual, search: vi.fn(() => mocked.results) };
});

import { highlightMatch } from '@/modules/highlight';
import '@/components/SearchBar';

function render(text: string, query: string): HTMLDivElement {
  const div = document.createElement('div');
  div.appendChild(highlightMatch(text, query));
  return div;
}

function marks(div: HTMLElement): string[] {
  return [...div.querySelectorAll('mark')].map((m) => m.textContent ?? '');
}

describe('highlightMatch — behaviour', () => {
  it('wraps the first case-insensitive match and preserves original casing', () => {
    const div = render('Fushimi Inari Shrine', 'inari');
    expect(marks(div)).toEqual(['Inari']);
    expect(div.textContent).toBe('Fushimi Inari Shrine');
  });

  it('match at start and at end', () => {
    expect(marks(render('Kyoto Station', 'kyo'))).toEqual(['Kyo']);
    expect(marks(render('Kyoto Station', 'TION'))).toEqual(['tion']);
  });

  it('whole-string match', () => {
    const div = render('Nara', 'nara');
    expect(div.childNodes).toHaveLength(1);
    expect(marks(div)).toEqual(['Nara']);
  });

  it('only the first of several occurrences is highlighted', () => {
    expect(marks(render('aa-aa-aa', 'aa'))).toEqual(['aa']);
  });

  it.each([
    ['no match', 'Osaka', 'tokyo'],
    ['empty query', 'Osaka', ''],
    ['query longer than text', 'Os', 'Osaka Castle'],
    ['empty text', '', 'x'],
  ])('%s → plain text, no <mark>', (_l, text, query) => {
    const div = render(text, query);
    expect(div.querySelector('mark')).toBeNull();
    expect(div.textContent).toBe(text);
  });

  it('length-changing lower-case characters do not misalign the slice', () => {
    const text = 'İstanbul Kebab'; // "İ".toLowerCase() is two code units
    const div = render(text, 'kebab');
    expect(div.textContent).toBe(text);
    expect(marks(div).every((m) => text.includes(m))).toBe(true);
  });

  it('mark styling is applied via CSSOM (no style attribute string built)', () => {
    const mark = render('Tokyo', 'tok').querySelector('mark')!;
    expect(mark.style.padding).toBe('0px 2px');
  });
});

describe('highlightMatch — XSS (SEC-10)', () => {
  it.each([
    ['img onerror in text', '<img src=x onerror=alert(1)>', 'img'],
    ['script in text', '<script>alert(1)</script>', 'alert'],
    ['svg onload in text', '<svg/onload=alert(1)>', 'svg'],
    ['payload split by the match', '<im' + 'g src=x onerror=alert(1)>', 'g src'],
    ['closing mark injection', 'a</mark><img src=x onerror=alert(1)>', 'a'],
    ['query itself is markup', 'x <b>bold</b> y', '<b>'],
    ['attribute breakout', '" onmouseover="alert(1)', 'onmouse'],
  ])('%s → rendered as text only', (_l, text, query) => {
    const div = render(text, query);
    expect(div.textContent).toBe(text);
    expect(div.querySelectorAll('*:not(mark)')).toHaveLength(0);
    expect(div.querySelectorAll('mark')).toHaveLength(1);
    expect(div.querySelector('mark')!.children).toHaveLength(0);
  });

  it('& is kept literal and serialized escaped', () => {
    const div = render('Tom & Jerry &amp; co', '&');
    expect(marks(div)).toEqual(['&']);
    expect(div.textContent).toBe('Tom & Jerry &amp; co');
    expect(div.innerHTML).toContain('&amp;amp;');
  });

  it('< and > are serialized escaped', () => {
    const div = render('a<b>c', 'b');
    expect(div.innerHTML).toBe('a&lt;<mark style="background: var(--jp-accent); color: var(--jp-white); padding: 0px 2px;">b</mark>&gt;c');
  });

  it.each([
    ['.*', 'anything', null],
    ['.*', 'a.*b', '.*'],
    ['(', 'call(x)', '('],
    ['[a-z]', 'set [a-z] here', '[a-z]'],
    ['\\', 'C:\\path', '\\'],
    ['$&', 'price $& more', '$&'],
    ["$'", "it$'s", "$'"],
    ['^', 'x^y', '^'],
    ['|', 'a|b', '|'],
    ['+?', 'c+?', '+?'],
    ['(?<x>a)', 'no groups', null],
  ])('regex metacharacters are literal: query %j in %j', (query, text, expected) => {
    const div = render(text, query);
    expect(div.textContent).toBe(text);
    expect(marks(div)).toEqual(expected === null ? [] : [expected]);
  });

  it('a 100 KB title with a match renders intact', () => {
    const text = '<i>'.repeat(20_000) + 'needle' + '<b>'.repeat(20_000);
    const div = render(text, 'needle');
    expect(div.textContent).toBe(text);
    expect(marks(div)).toEqual(['needle']);
    expect(div.querySelector('i, b')).toBeNull();
  });
});

describe('<search-bar> result rendering (SEC-10)', () => {
  let bar: HTMLElement & Record<string, unknown>;

  const evil: SearchResult = {
    type: 'activity',
    title: '<img src=x onerror="window.__pwned=1">Temple',
    subtitle: '<script>window.__pwned=1</script>Kyoto · Day 1',
    city: 'Kyoto',
    cityKey: 'kyoto',
    date: '2026-03-01',
    color: 'red" onmouseover="window.__pwned=1',
    url: 'kyoto.html',
  };
  const plain: SearchResult = { ...evil, title: 'Kinkaku-ji', subtitle: 'Kyoto', color: '#ff0000', type: 'day' };

  function shadow(): ShadowRoot {
    return bar.shadowRoot!;
  }

  function searchFor(query: string, results: SearchResult[]) {
    mocked.results = results;
    const input = shadow().querySelector('input')!;
    input.value = query;
    (bar['run'] as (q: string) => void).call(bar, query);
  }

  beforeEach(() => {
    bar = document.createElement('search-bar') as HTMLElement & Record<string, unknown>;
    document.body.appendChild(bar);
    (window as unknown as Record<string, unknown>)['__pwned'] = undefined;
  });

  afterEach(() => {
    bar.remove();
  });

  it('hostile title/subtitle/color produce no elements or handlers', async () => {
    searchFor('temple', [evil]);
    const list = shadow().querySelector('.search-results')!;
    expect(list.querySelectorAll('img, script')).toHaveLength(0);
    expect(list.querySelector('.result-title')!.textContent).toBe(evil.title);
    expect(list.querySelector('.result-title mark')!.textContent).toBe('Temple');
    expect(list.querySelector('.result-subtitle')!.textContent).toBe(evil.subtitle);
    const icon = list.querySelector<HTMLElement>('.result-icon')!;
    expect(icon.getAttribute('onmouseover')).toBeNull();
    expect(icon.style.background).toBe(''); // invalid CSS value dropped
    await new Promise((r) => setTimeout(r, 0));
    expect((window as unknown as Record<string, unknown>)['__pwned']).toBeUndefined();
  });

  it('valid colour, badge text and keyboard hint still render', () => {
    searchFor('kin', [plain]);
    const list = shadow().querySelector('.search-results')!;
    expect(list.querySelector<HTMLElement>('.result-icon.has-color')!.style.background).toBe('rgb(255, 0, 0)');
    expect(list.querySelector('.result-badge')!.textContent).toBe('day');
    expect(list.querySelector('.keyboard-hint kbd')).not.toBeNull();
    expect(list.querySelector('.result-icon svg')).not.toBeNull();
  });

  it('a query containing markup is highlighted literally', () => {
    searchFor('<b>', [{ ...plain, title: 'x <b> y' }]);
    const title = shadow().querySelector('.result-title')!;
    expect(title.querySelector('b')).toBeNull();
    expect(title.querySelector('mark')!.textContent).toBe('<b>');
  });

  it('clicking a result navigates with that exact result', () => {
    const spy = vi.fn();
    bar['handleResultClick'] = spy;
    searchFor('kin', [plain, { ...plain, title: 'Second' }]);
    shadow().querySelectorAll<HTMLAnchorElement>('.search-result')[1]!.click();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Second' }));
  });

  it('keyboard selection still toggles aria-selected on rebuilt items', () => {
    // jsdom has no layout, so no scrollIntoView.
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scroll, configurable: true, writable: true });
    searchFor('kin', [plain, { ...plain, title: 'Second' }]);
    shadow().querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    const items = shadow().querySelectorAll('.search-result');
    expect(items[0]!.getAttribute('aria-selected')).toBe('true');
    expect(items[1]!.getAttribute('aria-selected')).toBe('false');
    expect(scroll).toHaveBeenCalled();
    delete (Element.prototype as unknown as Record<string, unknown>)['scrollIntoView'];
  });

  it('re-searching replaces previous results', () => {
    searchFor('kin', [plain, plain, plain]);
    searchFor('kin', [plain]);
    expect(shadow().querySelectorAll('.search-result')).toHaveLength(1);
  });

  it('no results shows the static empty state', () => {
    searchFor('zzz', []);
    expect(shadow().querySelector('.search-empty')!.textContent).toContain('No results found');
  });
});
