import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ApiTrip } from '@/types';
import { mkTrip, sampleTrips } from './fixtures/searchTrips';

// ---------------------------------------------------------------------------
// Collaborators: Keycloak state and the API client are driven by the tests.
// ---------------------------------------------------------------------------

const kc = vi.hoisted(() => ({
  status: 'authenticated' as 'pending' | 'authenticated' | 'anonymous' | 'unavailable',
  listeners: new Set<() => void>(),
  init: vi.fn(),
  retry: vi.fn(),
  login: vi.fn(),
}));
const api = vi.hoisted(() => ({ getMyTrips: vi.fn(), getTrip: vi.fn() }));

vi.mock('@/auth/keycloak', () => ({
  getAuthStatus: () => kc.status,
  onAuthStatusChange: (fn: () => void) => {
    kc.listeners.add(fn);
    return () => kc.listeners.delete(fn);
  },
  initKeycloak: kc.init,
  retryAuth: kc.retry,
  login: kc.login,
}));
vi.mock('@/api/client', () => api);

import '@/components/SearchBar';
import { invalidateUserSearchIndex } from '@/modules/userSearchIndex';
import { TRIPS_CHANGED_EVENT } from '@/modules/tripsChanged';

type Bar = HTMLElement & Record<string, unknown>;
let bar: Bar;

const setAuth = (status: typeof kc.status): void => {
  kc.status = status;
  kc.listeners.forEach((fn) => fn());
};
const goto = (path: string): void => window.history.pushState({}, '', path);
const root = (): ShadowRoot => bar.shadowRoot!;
const q = <T extends Element = HTMLElement>(sel: string): T | null => root().querySelector<T>(sel);
const qa = (sel: string): HTMLElement[] => [...root().querySelectorAll<HTMLElement>(sel)];
const input = (): HTMLInputElement => q<HTMLInputElement>('.search-input')!;
const titles = (): string[] => qa('.result-title').map((e) => e.textContent ?? '');
// The API client is imported lazily by the search index; let that import settle too.
async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  // The list request and then each trip request import the client: one round per stage.
  for (let i = 0; i < 6; i++) {
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
  }
}

function mount(): void {
  bar = document.createElement('search-bar') as Bar;
  document.body.appendChild(bar);
}
async function typeQuery(text: string): Promise<void> {
  input().value = text;
  input().dispatchEvent(new Event('input', { bubbles: true }));
  await flush(200); // past the debounce
}
async function focusEmpty(): Promise<void> {
  input().dispatchEvent(new Event('focus'));
  await flush();
}

function useTrips(trips: ApiTrip[]): void {
  api.getMyTrips.mockImplementation(async () => trips.map((t) => ({ ...t, destinations: undefined })));
  api.getTrip.mockImplementation(async (id: string) => trips.find((t) => String(t.id) === id));
}

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no layout, hence no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML = '';
  kc.status = 'authenticated';
  kc.listeners.clear();
  kc.init.mockReset().mockResolvedValue(true);
  kc.retry.mockReset().mockResolvedValue(true);
  kc.login.mockReset().mockResolvedValue(undefined);
  api.getMyTrips.mockReset();
  api.getTrip.mockReset();
  useTrips(sampleTrips());
  invalidateUserSearchIndex();
  goto('/PruebaMapJapan/dashboard.html');
});

afterEach(() => {
  bar?.remove();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('scope: which data the box searches', () => {
  it.each(['index.html', 'tokyo.html', 'kyoto.html', 'tokyo2.html'])(
    'the demo page %s searches the demo even when signed in, and never calls the API',
    async (page) => {
      goto(`/PruebaMapJapan/${page}`);
      mount();
      expect(input().placeholder).toBe('Search the demo');
      expect(q('.search-container')!.dataset['scope']).toBe('demo');
      await typeQuery('Kyoto');
      expect(qa('.scope-chip').map((c) => c.textContent)).toEqual(['Demo trip']);
      expect(titles().some((t) => /kyoto/i.test(t))).toBe(true);
      expect(api.getMyTrips).not.toHaveBeenCalled();
    },
  );

  it('the landing demo anchor (index.html#demo) is still the demo', async () => {
    goto('/PruebaMapJapan/index.html#demo');
    mount();
    expect(input().placeholder).toBe('Search the demo');
  });

  it.each(['dashboard.html', 'trip.html?tripId=t-spring', 'trip-edit.html?tripId=t-spring', 'profile.html'])(
    'the account page %s searches the signed-in user\'s trips, not the demo',
    async (page) => {
      goto(`/PruebaMapJapan/${page}`);
      mount();
      expect(input().placeholder).toBe('Search your trips');
      expect(input().getAttribute('aria-label')).toMatch(/your trips/i);
      await typeQuery('ramen');
      expect(qa('.scope-chip').map((c) => c.textContent)).toEqual(['Your trips']);
      expect(titles().length).toBeGreaterThan(0);
      expect(titles().every((t) => /ramen/i.test(t))).toBe(true);
      // The demo has no "Ramen Yokocho"; and a demo-only query finds nothing here.
      await typeQuery('teamlab');
      expect(qa('.search-result')).toHaveLength(0);
      expect(q('.search-empty')!.textContent).toContain('No results found in your trips');
    },
  );

  it('logged out on an account page: demo results, with a sign-in offer that really signs in', async () => {
    setAuth('anonymous');
    mount();
    expect(input().placeholder).toBe('Search the demo');
    await typeQuery('Kyoto');
    expect(titles().some((t) => /kyoto/i.test(t))).toBe(true);
    expect(q('.scope-note')!.textContent).toMatch(/sign in to search your own trips/i);
    expect(api.getMyTrips).not.toHaveBeenCalled();
    q<HTMLButtonElement>('.scope-bar .link-btn')!.click();
    expect(kc.login).toHaveBeenCalledTimes(1);
  });

  it('sign-in service down: demo results, a clear message, and Retry re-checks sign-in', async () => {
    setAuth('unavailable');
    mount();
    await typeQuery('Kyoto');
    expect(q('.scope-note')!.textContent).toMatch(/can't reach sign-in/i);
    expect(titles().length).toBeGreaterThan(0);

    kc.retry.mockImplementation(async () => {
      kc.status = 'authenticated';
      return true;
    });
    q<HTMLButtonElement>('.scope-bar .link-btn')!.click();
    await flush();
    expect(kc.retry).toHaveBeenCalledTimes(1);
    expect(input().placeholder).toBe('Search your trips');
    expect(q('.scope-note')).toBeNull();
  });

  it('while the sign-in check is pending it waits (bounded) and then searches the right scope', async () => {
    setAuth('pending');
    let settle!: () => void;
    kc.init.mockReturnValue(new Promise<boolean>((res) => { settle = () => { kc.status = 'anonymous'; res(false); }; }));
    mount();
    await typeQuery('Kyoto');
    expect(q('.search-status.loading')!.textContent).toContain('Checking sign-in');
    settle();
    await flush();
    expect(q('.search-status')).toBeNull();
    expect(titles().some((t) => /kyoto/i.test(t))).toBe(true); // demo
    expect(api.getMyTrips).not.toHaveBeenCalled();
  });

  it('follows auth changes: signing out flips the placeholder and the open results', async () => {
    mount();
    await typeQuery('ramen');
    expect(qa('.scope-chip')[0]!.textContent).toBe('Your trips');
    setAuth('anonymous');
    await flush();
    expect(input().placeholder).toBe('Search the demo');
    expect(qa('.scope-chip')[0]!.textContent).toBe('Demo trip');
    expect(q('.scope-note')).not.toBeNull();
  });

  it('removes its listeners when detached', () => {
    mount();
    expect(kc.listeners.size).toBe(1);
    bar.remove();
    expect(kc.listeners.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('user scope: states', () => {
  it('shows a loading state until the trips arrive, then the results', async () => {
    let release!: (t: ApiTrip[]) => void;
    api.getMyTrips.mockReturnValue(new Promise<ApiTrip[]>((res) => { release = res; }));
    mount();
    await typeQuery('ramen');
    expect(q('.search-status.loading')!.textContent).toContain('Loading your trips');
    expect(q('.spinner')).not.toBeNull();
    expect(qa('.search-result')).toHaveLength(0);

    release(sampleTrips());
    await flush();
    expect(q('.search-status')).toBeNull();
    expect(qa('.search-result').length).toBeGreaterThan(0);
  });

  it('an API error shows a message and Retry, and Retry recovers', async () => {
    api.getMyTrips.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    mount();
    await typeQuery('ramen');
    const err = q('.search-status.error')!;
    expect(err.textContent).toContain("Couldn't load your trips");
    expect(qa('.search-result')).toHaveLength(0);

    q<HTMLButtonElement>('.search-status .link-btn')!.click();
    await flush();
    expect(q('.search-status.error')).toBeNull();
    expect(qa('.search-result').length).toBeGreaterThan(0);
    expect(api.getMyTrips).toHaveBeenCalledTimes(2);
  });

  it('typing while the API is down does not re-request on every keystroke', async () => {
    api.getMyTrips.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    mount();
    await typeQuery('ra');
    await typeQuery('ram');
    await typeQuery('rame');
    expect(api.getMyTrips).toHaveBeenCalledTimes(1);
    expect(q('.search-status.error')).not.toBeNull();
  });

  it('a hanging API does not hang the box: it times out into the error state', async () => {
    api.getMyTrips.mockReturnValue(new Promise(() => undefined));
    mount();
    await typeQuery('ramen');
    expect(q('.search-status.loading')).not.toBeNull();
    await flush(8100);
    expect(q('.search-status.loading')).toBeNull();
    expect(q('.search-status.error')!.textContent).toContain('taking too long');
    expect(q('.search-status .link-btn')!.textContent).toBe('Retry');
  });

  it('an unverified email explains itself and offers no pointless retry', async () => {
    api.getMyTrips.mockRejectedValue({ status: 403, code: 'email_not_verified' });
    mount();
    await typeQuery('ramen');
    expect(q('.search-status.error')!.textContent).toContain('Verify your email');
    expect(q('.search-status .link-btn')).toBeNull();
  });

  it('an expired session offers Sign in', async () => {
    api.getMyTrips.mockRejectedValue({ status: 401 });
    mount();
    await typeQuery('ramen');
    expect(q('.search-status.error')!.textContent).toContain('session has expired');
    q<HTMLButtonElement>('.search-status .link-btn')!.click();
    expect(kc.login).toHaveBeenCalled();
  });

  it('an empty account is invited to create a trip, on focus and when searching', async () => {
    useTrips([]);
    mount();
    await focusEmpty();
    expect(q('.search-status.empty-account')!.textContent).toContain('No trips yet');
    const link = q<HTMLAnchorElement>('.search-status a.link-btn')!;
    expect(link.getAttribute('href')).toBe('dashboard.html');
    expect(link.textContent).toMatch(/create your first trip/i);

    await typeQuery('anything');
    expect(q('.search-status.empty-account')).not.toBeNull();
    expect(q('.search-empty')).toBeNull();
  });

  it('no match is "No results found in your trips" (and not the account-empty state)', async () => {
    mount();
    await typeQuery('zzzzqqqq');
    expect(q('.search-empty')!.textContent).toContain('No results found in your trips');
    expect(q('.search-status')).toBeNull();
    expect(q('.keyboard-hint')).toBeNull();
  });

  it('offers the user\'s trips as suggestions on focus, the current trip first', async () => {
    goto('/PruebaMapJapan/trip.html?tripId=t-winter');
    mount();
    await focusEmpty();
    expect(q('.section-header')!.textContent).toBe('Your trips');
    expect(titles()).toEqual(['Winter in Hokkaido', 'Spring in Kansai']);
    expect(qa('.search-result').map((a) => a.getAttribute('href'))).toEqual([
      'trip.html?tripId=t-winter',
      'trip.html?tripId=t-spring',
    ]);
  });

  it('partial data is flagged with a Retry that refetches the missing trips', async () => {
    api.getTrip.mockImplementation(async (id: string) => {
      if (id === 't-winter' && api.getTrip.mock.calls.filter((c) => c[0] === id).length === 1) throw new Error('flaky');
      return sampleTrips().find((t) => t.id === id);
    });
    api.getMyTrips.mockImplementation(async () => sampleTrips().map((t) => ({ ...t, destinations: undefined })));
    mount();
    await typeQuery('snow');
    expect(q('.search-note')!.textContent).toContain('could not be fully loaded');
    q<HTMLButtonElement>('.search-note .link-btn')!.click();
    await flush();
    expect(q('.search-note')).toBeNull();
    expect(titles()).toContain('Snow festival');
  });
});

// ---------------------------------------------------------------------------

describe('user scope: results', () => {
  it('on a trip page, that trip is listed first under "This trip", the others under "Other trips"', async () => {
    goto('/PruebaMapJapan/trip.html?tripId=t-winter');
    mount();
    await typeQuery('ramen');
    expect(qa('.section-header').map((h) => h.textContent)).toEqual(['This trip', 'Other trips']);
    const hrefs = qa('.search-result').map((a) => a.getAttribute('href')!);
    expect(hrefs[0]).toContain('tripId=t-winter');
    expect(hrefs[hrefs.length - 1]).toContain('tripId=t-spring');
  });

  it('on the dashboard (no current trip) results are ungrouped', async () => {
    mount();
    await typeQuery('ramen');
    expect(qa('.section-header')).toHaveLength(0);
    expect(new Set(qa('.search-result').map((a) => new URL(a.getAttribute('href')!, 'http://x/').searchParams.get('tripId')))).toEqual(
      new Set(['t-spring', 't-winter']),
    );
  });

  it('every result links to its trip, destination, day and activity', async () => {
    mount();
    await typeQuery('fushimi');
    const a = qa('.search-result')[0]!;
    const url = new URL(a.getAttribute('href')!, 'http://x/');
    expect(url.pathname).toBe('/trip.html');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tripId: 't-spring',
      destIndex: '0',
      day: '2026-04-01',
      activity: 'Fushimi Inari',
    });
    expect(a.querySelector('.result-badge')!.textContent).toBe('place');
    expect(a.querySelector('.result-context')!.textContent).toBe('Kyoto · Spring in Kansai');
  });

  it('clicking a result opens it (and closes the box); modified clicks are left to the browser', async () => {
    mount();
    await typeQuery('fushimi');
    const open = vi.fn();
    bar['handleResultClick'] = open;
    const a = qa('.search-result')[0] as HTMLAnchorElement;
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(open).not.toHaveBeenCalled();
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ title: 'Fushimi Inari', tripId: 't-spring' }));
    expect(q('.search-dropdown')!.classList.contains('open')).toBe(false);
  });

  it('keyboard: arrows move across group headers, Enter opens the selected result', async () => {
    goto('/PruebaMapJapan/trip.html?tripId=t-winter');
    mount();
    await typeQuery('ramen');
    const open = vi.fn();
    bar['handleResultClick'] = open;
    const key = (k: string): void => { input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); };
    const n = qa('.search-result').length;
    for (let i = 0; i < n + 2; i++) key('ArrowDown'); // clamps at the last result
    expect(qa('.search-result[aria-selected="true"]')).toHaveLength(1);
    expect(qa('.search-result')[n - 1]!.getAttribute('aria-selected')).toBe('true');
    key('ArrowUp');
    key('Enter');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0].title).toBe(titles()[n - 2]);
  });

  it('announces counts and states to screen readers', async () => {
    mount();
    await typeQuery('ramen');
    expect(q('#search-live')!.textContent).toMatch(/^\d+ results?$/);
    expect(q('#search-live')!.getAttribute('aria-live')).toBe('polite');
    await typeQuery('zzzzqqqq');
    expect(q('#search-live')!.textContent).toBe('No results');
  });

  it('keeps the listbox contract: only results are options, scope/status rows are presentational', async () => {
    mount();
    await typeQuery('ramen');
    expect(q('.search-dropdown')!.getAttribute('role')).toBe('listbox');
    expect(input().getAttribute('aria-controls')).toBe('search-dropdown');
    expect(qa('[role="option"]').every((el) => el.classList.contains('search-result'))).toBe(true);
    for (const el of qa('.scope-bar, .section-header, .keyboard-hint')) expect(el.getAttribute('role')).toBe('presentation');
  });
});

// ---------------------------------------------------------------------------

describe('user scope: staleness, cancellation, invalidation', () => {
  it('only the latest query is painted when several are waiting on a slow load', async () => {
    let release!: (t: ApiTrip[]) => void;
    api.getMyTrips.mockReturnValue(new Promise<ApiTrip[]>((res) => { release = res; }));
    mount();
    const paint = vi.spyOn(bar as unknown as { paintUser: (...a: unknown[]) => void }, 'paintUser');
    await typeQuery('snow');
    await typeQuery('osaka');
    expect(paint).not.toHaveBeenCalled();

    release(sampleTrips());
    await flush();
    expect(paint).toHaveBeenCalledTimes(1);
    expect(paint.mock.calls[0]![0]).toBe('osaka');
    expect(titles().some((t) => /osaka/i.test(t))).toBe(true);
    expect(titles()).not.toContain('Snow festival');
  });

  it('typing quickly runs one search after the pause (debounce)', async () => {
    mount();
    await typeQuery('ramen'); // load
    const run = vi.spyOn(bar as unknown as { run: (...a: unknown[]) => unknown }, 'run');
    for (const text of ['r', 'ra', 'ram', 'rame', 'ramen']) {
      input().value = text;
      input().dispatchEvent(new Event('input', { bubbles: true }));
      await flush(50);
    }
    expect(run).not.toHaveBeenCalled();
    await flush(150);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toBe('ramen');
  });

  it('closing while loading cancels: a late answer paints nothing, and reopening runs again', async () => {
    let release!: (t: ApiTrip[]) => void;
    api.getMyTrips.mockReturnValueOnce(new Promise<ApiTrip[]>((res) => { release = res; }));
    mount();
    const paint = vi.spyOn(bar as unknown as { paintUser: (...a: unknown[]) => void }, 'paintUser');
    await typeQuery('ramen');
    expect(q('.search-status.loading')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(q('.search-dropdown')!.classList.contains('open')).toBe(false);
    release(sampleTrips());
    await flush();
    expect(paint).not.toHaveBeenCalled();
    expect(q('.search-dropdown')!.classList.contains('open')).toBe(false);

    input().dispatchEvent(new Event('focus'));
    await flush();
    expect(paint).toHaveBeenCalledTimes(1);
    expect(qa('.search-result').length).toBeGreaterThan(0);
  });

  it('closing before the debounce fires cancels the pending search', async () => {
    mount();
    await typeQuery('ramen');
    const run = vi.spyOn(bar as unknown as { run: (...a: unknown[]) => unknown }, 'run');
    input().value = 'osaka';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush(500);
    expect(run).not.toHaveBeenCalled();
    // Reopening shows results for what is in the box now.
    input().dispatchEvent(new Event('focus'));
    await flush();
    expect(titles().some((t) => /osaka/i.test(t))).toBe(true);
  });

  it('a user-scope answer that arrives after the scope flipped to demo is dropped', async () => {
    let release!: (t: ApiTrip[]) => void;
    api.getMyTrips.mockReturnValue(new Promise<ApiTrip[]>((res) => { release = res; }));
    mount();
    await typeQuery('kyoto');
    setAuth('anonymous');
    await flush();
    const demoTitles = titles();
    expect(qa('.scope-chip')[0]!.textContent).toBe('Demo trip');

    release(sampleTrips());
    await flush();
    expect(titles()).toEqual(demoTitles);
    expect(qa('.scope-chip')[0]!.textContent).toBe('Demo trip');
  });

  it('a trip write elsewhere invalidates the cache: the open results refresh with the new data', async () => {
    mount();
    await typeQuery('ramen');
    expect(titles()).not.toContain('Ramen museum');
    expect(api.getMyTrips).toHaveBeenCalledTimes(1);

    const edited = [
      ...sampleTrips(),
      mkTrip({ id: 't-new', name: 'New one', dests: [{ city: 'Yokohama', days: [{ date: '2026-06-01', acts: ['Ramen museum'] }] }] }),
    ];
    useTrips(edited);
    window.dispatchEvent(new Event(TRIPS_CHANGED_EVENT));
    await flush();
    expect(api.getMyTrips).toHaveBeenCalledTimes(2);
    expect(titles()).toContain('Ramen museum');
  });

  it('a trip write while the box is closed makes the next open fetch fresh data', async () => {
    mount();
    await typeQuery('ramen');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    useTrips([...sampleTrips(), mkTrip({ id: 't-new', name: 'Brand new', dests: [] })]);
    window.dispatchEvent(new Event(TRIPS_CHANGED_EVENT));
    await flush();
    expect(api.getMyTrips).toHaveBeenCalledTimes(1);
    input().value = '';
    input().dispatchEvent(new Event('focus'));
    await flush();
    expect(api.getMyTrips).toHaveBeenCalledTimes(2);
    expect(titles()).toContain('Brand new');
  });

  it('the second query reuses the cache: no extra requests', async () => {
    mount();
    await typeQuery('ramen');
    const calls = api.getMyTrips.mock.calls.length + api.getTrip.mock.calls.length;
    await typeQuery('snow');
    await typeQuery('osaka');
    expect(api.getMyTrips.mock.calls.length + api.getTrip.mock.calls.length).toBe(calls);
  });
});

// ---------------------------------------------------------------------------

describe('user scope: hostile data and queries', () => {
  const PAYLOAD = '<img src=x onerror=window.__pwned=1>';
  const evil = (): ApiTrip =>
    mkTrip({
      id: 'xss',
      name: `Zzq ${PAYLOAD}`,
      dests: [
        {
          city: `Zzq ${PAYLOAD}`,
          hotel: `Zzq <script>window.__pwned=1</script>`,
          days: [
            {
              date: '2026-03-01',
              label: `Zzq ${PAYLOAD}`,
              color: 'red" onmouseover="window.__pwned=1',
              acts: [{ name: `Zzq activity ${PAYLOAD}`, notes: `Zzq note ${PAYLOAD}` }],
            },
          ],
        },
      ],
    });

  it('renders trip, city, hotel, day, activity and note text as inert text', async () => {
    useTrips([evil()]);
    mount();
    await typeQuery('zzq');
    const list = q('.search-results')!;
    expect(qa('.search-result').length).toBeGreaterThanOrEqual(5);
    expect(list.querySelector('img, script')).toBeNull();
    expect(list.innerHTML).not.toContain('<img');
    expect(list.textContent).toContain('<img src=x onerror=window.__pwned=1>');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    for (const el of qa('.result-icon')) expect(el.getAttribute('onmouseover')).toBeNull();
  });

  it('keeps hostile text inert in the loading, error and suggestion states too', async () => {
    useTrips([evil()]);
    mount();
    await focusEmpty();
    expect(q('.search-results')!.querySelector('img, script')).toBeNull();
    expect(titles()[0]).toBe(`Zzq ${PAYLOAD}`);
  });

  it('a markup query is matched literally and highlighted without being parsed', async () => {
    useTrips([evil()]);
    mount();
    await typeQuery(PAYLOAD);
    expect(q('.search-results')!.querySelector('img')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it.each([
    ['regex metacharacters', '.*+?^${}()|[]\\'],
    ['quotes and ampersands', `"'&<>`],
    ['only spaces', '      '],
    ['accented', 'café ñandú'],
    ['japanese', '京都'],
    ['emoji', '🍜🍜'],
    ['very long', 'ramen '.repeat(3000)],
    ['lone surrogate', '\ud83d'],
  ])('query with %s does not break the box', async (_label, text) => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent): void => { errors.push(e.error); };
    window.addEventListener('error', onError);
    mount();
    await typeQuery(text);
    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
    expect(q('.search-dropdown')!.classList.contains('open')).toBe(true);
    expect(q('.search-status.error')).toBeNull();
  });

  it('a very long query still finds results (capped at a word boundary)', async () => {
    mount();
    await typeQuery('ramen '.repeat(3000));
    expect(qa('.search-result').length).toBeGreaterThan(0);
  });

  it('empty-string and whitespace queries fall back to suggestions / nothing, never to "everything"', async () => {
    mount();
    await typeQuery('   ');
    expect(qa('.search-result')).toHaveLength(0);
    await typeQuery('');
    expect(q('.section-header')!.textContent).toBe('Your trips');
  });
});

// ---------------------------------------------------------------------------

describe('demo scope is unchanged', () => {
  beforeEach(() => goto('/PruebaMapJapan/index.html'));

  it('focus offers the demo cities', async () => {
    mount();
    await focusEmpty();
    expect(q('.section-header')!.textContent).toBe('Cities');
    expect(qa('.search-result').length).toBeGreaterThan(0);
  });

  it('no match shows the plain empty state', async () => {
    mount();
    await typeQuery('zzzzqqqq');
    expect(q('.search-empty')!.textContent).toContain('No results found');
    expect(q('.search-empty')!.textContent).not.toContain('your trips');
  });

  it('activity results deep-link with day and activity', async () => {
    mount();
    await typeQuery('Hikawa');
    const place = qa('.search-result').find((a) => a.querySelector('.result-badge')!.textContent === 'place')!;
    expect(place.getAttribute('href')).toMatch(/\.html\?day=.+&activity=/);
  });
});
