import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildForecastUrl,
  cacheKeyFor,
  describePeriod,
  mountTripWeather,
  parseForecast,
  pickForecastWindow,
  requestForecast,
  type ForecastWindow,
} from '@/modules/tripWeather';

const TODAY = '2026-10-09';
const range = (start: string, end: string): ForecastWindow => ({ kind: 'range', start, end });
const CURRENT: ForecastWindow = { kind: 'current', reason: 'undated' };

// ---------------------------------------------------------------------------
// Which days
// ---------------------------------------------------------------------------

describe('pickForecastWindow', () => {
  it.each([
    ['a stay inside the horizon', '2026-10-12', '2026-10-14', range('2026-10-12', '2026-10-14')],
    ['a one-day stay', '2026-10-12', '2026-10-12', range('2026-10-12', '2026-10-12')],
    ['a long stay shows its first five days', '2026-10-12', '2026-10-30', range('2026-10-12', '2026-10-16')],
    ['a stay under way starts today', '2026-10-05', '2026-10-12', range('2026-10-09', '2026-10-12')],
    ['a stay ending today', '2026-10-05', '2026-10-09', range('2026-10-09', '2026-10-09')],
    ['a stay starting on the last forecast day', '2026-10-23', '2026-10-30', range('2026-10-23', '2026-10-23')],
    ['a stay straddling the horizon is clipped to it', '2026-10-21', '2026-11-05', range('2026-10-21', '2026-10-23')],
    ['only a start date counts as a stay starting then', '2026-10-12', null, range('2026-10-12', '2026-10-16')],
    ['only an end date counts as a one-day stay', null, '2026-10-12', range('2026-10-12', '2026-10-12')],
    ['an end before the start is read as a one-day stay', '2026-10-14', '2026-10-12', range('2026-10-14', '2026-10-14')],
  ])('%s', (_label, start, end, expected) => {
    expect(pickForecastWindow(start, end, TODAY)).toEqual(expected);
  });

  it.each([
    ['no dates', null, null, 'undated'],
    ['blank dates', '', '  ', 'undated'],
    ['impossible dates', '2026-02-30', 'nope', 'undated'],
    ['a stay that is over', '2026-09-01', '2026-10-08', 'past'],
    ['a stay beyond the horizon', '2026-10-24', '2026-11-01', 'beyond'],
    ['a stay years away', '2031-05-01', '2031-05-09', 'beyond'],
  ])('%s: current weather', (_label, start, end, reason) => {
    expect(pickForecastWindow(start, end, TODAY)).toEqual({ kind: 'current', reason });
  });

  it('never throws on a bad "today"', () => {
    expect(pickForecastWindow('2026-10-12', '2026-10-14', 'garbage')).toEqual({ kind: 'current', reason: 'undated' });
  });
});

describe('buildForecastUrl', () => {
  it('asks for the stay, in the destination timezone, with coordinates rounded to ~1 km', () => {
    const url = new URL(buildForecastUrl(35.011636, 135.768029, range('2026-10-12', '2026-10-14')));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '35.01',
      longitude: '135.77',
      current: 'temperature_2m,weather_code',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      timezone: 'auto',
      start_date: '2026-10-12',
      end_date: '2026-10-14',
    });
  });

  it('asks for the next five days when there is no usable stay', () => {
    const url = new URL(buildForecastUrl(-33.87, 151.21, CURRENT));
    expect(url.searchParams.get('forecast_days')).toBe('5');
    expect(url.searchParams.has('start_date')).toBe(false);
    expect(url.searchParams.get('latitude')).toBe('-33.87');
  });

  it('cache keys differ by place and period', () => {
    const a = cacheKeyFor(35.01, 135.76, range('2026-10-12', '2026-10-14'));
    expect(a).not.toBe(cacheKeyFor(35.01, 135.76, range('2026-10-13', '2026-10-14')));
    expect(a).not.toBe(cacheKeyFor(35.02, 135.76, range('2026-10-12', '2026-10-14')));
    expect(cacheKeyFor(35.011, 135.761, CURRENT)).toBe(cacheKeyFor(35.012, 135.762, CURRENT)); // same ~1 km cell
  });
});

// ---------------------------------------------------------------------------
// What a response means
// ---------------------------------------------------------------------------

const payload = (overrides: Record<string, unknown> = {}) => ({
  current: { temperature_2m: 12.6, weather_code: 3 },
  daily: {
    time: ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'],
    weather_code: [0, 61, 3, 71, 95],
    temperature_2m_max: [15.2, 14.5, 13.1, 9.9, 10],
    temperature_2m_min: [5, 6.4, 7, 2, 3],
  },
  ...overrides,
});

describe('parseForecast', () => {
  it('current weather: the headline is now, the list is the days after today (like the demo)', () => {
    const v = parseForecast(payload(), CURRENT, TODAY)!;
    expect(v.headline).toEqual({ kind: 'now', temp: 12.6, code: 3, date: null });
    expect(v.days.map((d) => d.date)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']);
    expect(v.days[0]).toEqual({ date: '2026-10-10', code: 61, max: 14.5, min: 6.4 });
  });

  it('a stay that starts today shows the current temperature too', () => {
    const v = parseForecast(payload(), range('2026-10-09', '2026-10-11'), TODAY)!;
    expect(v.headline.kind).toBe('now');
  });

  it('a stay that starts later headlines the first day high', () => {
    const p = payload({
      daily: { time: ['2026-10-12', '2026-10-13'], weather_code: [71, 95], temperature_2m_max: [9.9, 10], temperature_2m_min: [2, 3] },
    });
    const v = parseForecast(p, range('2026-10-12', '2026-10-13'), TODAY)!;
    expect(v.headline).toEqual({ kind: 'high', temp: 9.9, code: 71, date: '2026-10-12' });
    expect(v.days).toEqual([{ date: '2026-10-13', code: 95, max: 10, min: 3 }]);
  });

  it('works without a "current" block (headline falls back to the first day)', () => {
    const v = parseForecast(payload({ current: undefined }), CURRENT, TODAY)!;
    expect(v.headline).toMatchObject({ kind: 'high', temp: 15.2, date: '2026-10-09' });
  });

  it('a one-day stay has no forecast list', () => {
    const p = payload({ daily: { time: ['2026-10-12'], weather_code: [1], temperature_2m_max: [9], temperature_2m_min: [3] } });
    expect(parseForecast(p, range('2026-10-12', '2026-10-12'), TODAY)!.days).toEqual([]);
  });

  it('drops days with missing numbers instead of rendering NaN', () => {
    const p = payload({
      daily: {
        time: ['2026-10-09', '2026-10-10', '2026-10-11'],
        weather_code: [0, null, 3],
        temperature_2m_max: [15, 14, null],
        temperature_2m_min: [5, 6, 7],
      },
    });
    const v = parseForecast(p, CURRENT, TODAY)!;
    expect(v.headline.kind).toBe('now');
    expect(v.days).toEqual([]);
  });

  it('keeps at most five days', () => {
    const time = Array.from({ length: 16 }, (_, i) => `2026-10-${String(9 + i).padStart(2, '0')}`).filter((d) => d <= '2026-10-31');
    const p = payload({
      daily: {
        time,
        weather_code: time.map(() => 1),
        temperature_2m_max: time.map(() => 10),
        temperature_2m_min: time.map(() => 5),
      },
    });
    expect(parseForecast(p, CURRENT, TODAY)!.days).toHaveLength(4);
  });

  it.each([
    ['null', null],
    ['a string', 'sunny'],
    ['an array', []],
    ['an empty object', {}],
    ['the demo-test garbage', { foo: 1 }],
    ['daily as a string', { daily: 'x' }],
    ['empty daily arrays', { current: { temperature_2m: 1, weather_code: 0 }, daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] } }],
    ['daily arrays of the wrong type', { daily: { time: 'a', weather_code: 1, temperature_2m_max: {}, temperature_2m_min: null } }],
    ['strings instead of numbers', payload({ daily: { time: ['2026-10-09'], weather_code: ['0'], temperature_2m_max: ['15'], temperature_2m_min: ['5'] } })],
    ['non-date times', payload({ daily: { time: ['<img src=x onerror=alert(1)>'], weather_code: [0], temperature_2m_max: [1], temperature_2m_min: [0] } })],
    ['infinite temperatures', payload({ daily: { time: ['2026-10-09'], weather_code: [0], temperature_2m_max: [Infinity], temperature_2m_min: [0] } })],
  ])('rejects %s', (_label, bad) => {
    expect(parseForecast(bad, CURRENT, TODAY)).toBeNull();
  });
});

describe('describePeriod', () => {
  it('says which days a forecast covers', () => {
    expect(describePeriod(range('2026-10-12', '2026-10-14'))).toBe('Forecast for 12–14 Oct');
    expect(describePeriod(range('2026-10-30', '2026-11-02'))).toBe('Forecast for 30 Oct–2 Nov');
    expect(describePeriod(range('2026-10-12', '2026-10-12'))).toBe('Forecast for 12 Oct');
  });
  it('explains why the current weather is shown', () => {
    expect(describePeriod({ kind: 'current', reason: 'undated' })).toContain('No dates');
    expect(describePeriod({ kind: 'current', reason: 'past' })).toContain('over');
    expect(describePeriod({ kind: 'current', reason: 'beyond' })).toContain('two weeks');
  });
});

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

function mountSection(): HTMLElement {
  document.body.innerHTML = `
    <section id="trip-weather" hidden>
      <article id="widget-weather"><div class="widget-content" aria-busy="true"></div></article>
    </section>`;
  return document.getElementById('trip-weather')!;
}
const NOW = new Date(2026, 9, 9, 12, 0, 0); // 9 Oct 2026, local
const STAY = { lat: '35.0116000', lng: 135.7681, start: '2026-10-12', end: '2026-10-14' };
const stayPayload = () => payload({
  daily: { time: ['2026-10-12', '2026-10-13', '2026-10-14'], weather_code: [0, 61, 3], temperature_2m_max: [18.4, 16, 15], temperature_2m_min: [9, 8, 7] },
});
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const state = (s: HTMLElement): string | undefined => s.dataset['state'];
const content = (): HTMLElement => document.querySelector<HTMLElement>('.widget-content')!;

const stops: Array<() => void> = [];
const mount = (section: HTMLElement, input: Parameters<typeof mountTripWeather>[1], options?: Parameters<typeof mountTripWeather>[2]): (() => void) => {
  const stop = mountTripWeather(section, input, options);
  stops.push(stop);
  return stop;
};

describe('mountTripWeather', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('IntersectionObserver', undefined);
  });
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('renders the demo markup for the stay and caches the payload', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(stayPayload()));
    vi.stubGlobal('fetch', fetchMock);
    const section = mountSection();
    mount(section, STAY, { now: NOW });
    await flush();

    expect(state(section)).toBe('ready');
    expect(section.hidden).toBe(false);
    const requested = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(requested.searchParams.get('start_date')).toBe('2026-10-12');
    expect(requested.searchParams.get('latitude')).toBe('35.01');
    expect(content().querySelector('.weather-temp')?.textContent).toBe('18°');
    expect(content().querySelector('.weather-temp')?.getAttribute('aria-label')).toContain('High on');
    expect(content().querySelector('.weather-condition span')?.textContent).toBe('Clear');
    expect(content().querySelector('.weather-period')?.textContent).toBe('Forecast for 12–14 Oct');
    expect(Array.from(content().querySelectorAll('.forecast-date')).map((e) => e.textContent)).toEqual(['Tue', 'Wed']);
    expect(Array.from(content().querySelectorAll('.forecast-max')).map((e) => e.textContent)).toEqual(['16°', '15°']);
    expect(content().querySelector('.weather-forecast')?.getAttribute('role')).toBe('list');
    expect(content().querySelectorAll('[role="listitem"]')).toHaveLength(2);
    expect(content().getAttribute('aria-busy')).toBe('false');
    expect(content().querySelector('.loader')).toBeNull();
  });

  it('a second mount for the same stay is served from the cache without a request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(stayPayload()));
    vi.stubGlobal('fetch', fetchMock);
    mount(mountSection(), STAY, { now: NOW });
    await flush();
    const section = mountSection();
    mount(section, STAY, { now: NOW });
    await flush();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(state(section)).toBe('ready');
  });

  it('a corrupted cache entry is dropped and refetched', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(stayPayload()));
    vi.stubGlobal('fetch', fetchMock);
    const key = cacheKeyFor(35.0116, 135.7681, range('2026-10-12', '2026-10-14'));
    localStorage.setItem(key, JSON.stringify({ data: { foo: 1 }, timestamp: Date.now() }));
    const section = mountSection();
    mount(section, STAY, { now: NOW });
    await flush();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(state(section)).toBe('ready');
  });

  it('never caches an unusable payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ foo: 1 })));
    mount(mountSection(), STAY, { now: NOW });
    await flush();
    expect(localStorage.length).toBe(0);
  });

  it.each([
    ['HTTP 500', () => new Response('boom', { status: 500 })],
    ['HTTP 429', () => new Response('slow down', { status: 429 })],
    ['malformed JSON', () => new Response('{"daily":', { status: 200 })],
    ['an HTML error page with 200', () => new Response('<html>proxy</html>', { status: 200 })],
    ['garbage JSON', () => jsonResponse({ foo: 1 })],
    ['an empty object', () => jsonResponse({})],
    ['no days', () => jsonResponse(payload({ daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] } }))],
  ])('%s: a short message with Try again, nothing thrown, page not blocked', async (_label, respond) => {
    const fetchMock = vi.fn(async () => respond());
    vi.stubGlobal('fetch', fetchMock);
    const section = mountSection();
    expect(() => mount(section, STAY, { now: NOW })).not.toThrow();
    await flush();

    expect(state(section)).toBe('problem');
    expect(section.hidden).toBe(false);
    expect(content().textContent).toContain('Weather unavailable');
    expect(content().querySelector('[role="status"]')).not.toBeNull();
    expect(content().getAttribute('aria-busy')).toBe('false');
    expect(content().querySelector('.loader')).toBeNull();

    // Try again recovers once the API does
    fetchMock.mockImplementation(async () => jsonResponse(stayPayload()));
    content().querySelector<HTMLButtonElement>('#trip-weather-retry')!.click();
    await flush();
    expect(state(section)).toBe('ready');
    expect(content().querySelector('#trip-weather-retry')).toBeNull();
  });

  it('the API unreachable (network error): the card hides itself', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const section = mountSection();
    mount(section, STAY, { now: NOW });
    await flush();
    expect(state(section)).toBe('hidden');
    expect(section.hidden).toBe(true);
  });

  it('a timeout aborts the request and hides the card', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const section = mountSection();
    mount(section, STAY, { now: NOW, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(state(section)).toBe('loading');
    expect(content().querySelector('.loader')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1001);
    expect(state(section)).toBe('hidden');
  });

  it('a body that stalls past the timeout also gives up', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    })));
    const outcome = requestForecast('https://api.open-meteo.com/v1/forecast', 500);
    await vi.advanceTimersByTimeAsync(600);
    await expect(outcome).resolves.toEqual({ ok: false, kind: 'unreachable' });
  });

  it('offline: no request, hidden, and it loads when the browser comes back online', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(stayPayload()));
    vi.stubGlobal('fetch', fetchMock);
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const section = mountSection();
    mount(section, STAY, { now: NOW });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state(section)).toBe('hidden');

    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(state(section)).toBe('ready');
    online.mockRestore();
  });

  it('no destination coordinates: no request, stays hidden', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const coords of [{ lat: null, lng: null }, { lat: undefined, lng: 135 }, { lat: 'abc', lng: 1 }, { lat: 95, lng: 1 }, { lat: '', lng: '' }]) {
      const section = mountSection();
      mount(section, { ...STAY, ...coords }, { now: NOW });
      await flush();
      expect(state(section)).toBe('hidden');
      expect(section.hidden).toBe(true);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a section without the card inside does nothing and does not throw', () => {
    document.body.innerHTML = '<section id="trip-weather" hidden></section>';
    const section = document.getElementById('trip-weather')!;
    expect(() => mount(section, STAY, { now: NOW })).not.toThrow();
    expect(section.hidden).toBe(true);
  });

  it('cleanup cancels: a late answer is ignored', async () => {
    let answer!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
    const section = mountSection();
    const stop = mount(section, STAY, { now: NOW });
    await flush();
    expect(state(section)).toBe('loading');
    stop();
    section.hidden = true;
    answer(jsonResponse(stayPayload()));
    await flush();
    expect(section.hidden).toBe(true);
    expect(content().querySelector('.weather-temp')).toBeNull();
  });

  it('waits to be near the viewport before asking (lazy), then loads once', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(stayPayload()));
    vi.stubGlobal('fetch', fetchMock);
    let trigger: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: typeof trigger) { trigger = cb; }
      observe(): void {}
      disconnect = disconnect;
    });
    const section = mountSection();
    mount(section, STAY, { now: NOW });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state(section)).toBe('loading'); // a loader is visible so there is something to observe
    expect(content().querySelector('.loader')).not.toBeNull();

    trigger!([{ isIntersecting: false }]);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    trigger!([{ isIntersecting: true }]);
    trigger!([{ isIntersecting: true }]);
    await flush();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalled();
    expect(state(section)).toBe('ready');
  });

  it('shows the current weather with an explanation for an undated stay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(payload())));
    const section = mountSection();
    mount(section, { ...STAY, start: null, end: null }, { now: NOW });
    await flush();
    expect(content().querySelector('.weather-temp')?.textContent).toBe('13°');
    expect(content().querySelector('.weather-temp')?.getAttribute('aria-label')).toBe('Current temperature 13 degrees');
    expect(content().querySelector('.weather-period')?.textContent).toContain('No dates for this stay yet');
    expect(content().querySelectorAll('.forecast-day')).toHaveLength(4);
  });

  it('renders only text and fixed icons: nothing from the response becomes markup', async () => {
    // Numbers are validated, so hostile strings cannot get in via the numeric fields...
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(payload({
      daily: { time: ['<b>x</b>'], weather_code: [0], temperature_2m_max: [1], temperature_2m_min: [0] },
    }))));
    const section = mountSection();
    mount(section, { ...STAY, start: null, end: null }, { now: NOW });
    await flush();
    expect(state(section)).toBe('problem');
    expect(content().querySelector('b')).toBeNull();
    // ...and the destination name never reaches this module's markup at all.
    expect(content().innerHTML).not.toContain('<b>');
  });
});

// ---------------------------------------------------------------------------
// Dates are calendar days: the same weekday in every viewer timezone
// ---------------------------------------------------------------------------

describe('forecast weekdays across timezones', () => {
  const ORIGINAL_TZ = process.env.TZ;
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it.each(['America/Argentina/Buenos_Aires', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland', 'Etc/GMT+12'])(
    '2026-10-13..14 are Tue/Wed in %s',
    async (tz) => {
      process.env.TZ = tz;
      vi.stubGlobal('IntersectionObserver', undefined);
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(stayPayload())));
      const section = mountSection();
      mountTripWeather(section, STAY, { now: new Date(2026, 9, 9, 12) });
      await flush();
      expect(Array.from(document.querySelectorAll('.forecast-date')).map((e) => e.textContent)).toEqual(['Tue', 'Wed']);
    },
  );
});
