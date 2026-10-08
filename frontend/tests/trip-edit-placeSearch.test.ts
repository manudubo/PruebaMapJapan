import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlaceSearch, SEARCH_ERROR_MESSAGE, type SearchState } from '@/pages/trip-edit/placeSearch';

const hit = (name: string, lat = '35.0', lon = '135.0') => ({ lat, lon, display_name: `${name}, Japan` });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function make(search = vi.fn(async (q: string) => [hit(q)]), mode: 'proxy' | 'direct' = 'proxy') {
  const s = new PlaceSearch({ search, mode, debounceMs: 500 });
  const states: SearchState[] = [];
  s.subscribe((st) => states.push(st));
  return { s, search, states };
}

describe('PlaceSearch', () => {
  it('waits for a pause in typing and searches once', async () => {
    const { s, search } = make();
    s.input('Kyo');
    s.input('Kyot');
    s.input('Kyoto');
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499);
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('Kyoto');
    expect(s.current).toMatchObject({ status: 'results', places: [{ name: 'Kyoto', country: 'Japan', lat: 35, lng: 135 }] });
  });

  it('very short input does not search', async () => {
    const { s, search } = make();
    s.input('Ky');
    await vi.advanceTimersByTimeAsync(5000);
    expect(search).not.toHaveBeenCalled();
    expect(s.current.status).toBe('short');
    s.input('   ');
    expect(s.current.status).toBe('idle');
  });

  it('direct mode (demo build) never searches while typing, only on submit', async () => {
    const { s, search } = make(undefined, 'direct');
    s.input('Kyoto');
    await vi.advanceTimersByTimeAsync(5000);
    expect(search).not.toHaveBeenCalled();
    await s.submit('Kyoto');
    expect(search).toHaveBeenCalledTimes(1);
    expect(s.current.status).toBe('results');
  });

  it('submit searches immediately and cancels the pending debounce', async () => {
    const { s, search } = make();
    s.input('Osaka');
    await s.submit('Osaka');
    await vi.advanceTimersByTimeAsync(5000);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('reuses answers it already has (rate limit: 20/min)', async () => {
    const { s, search } = make();
    await s.submit('Nara');
    await s.submit('  nara ');
    s.input('NARA');
    await vi.advanceTimersByTimeAsync(5000);
    expect(search).toHaveBeenCalledTimes(1);
    expect(s.current.status).toBe('results');
  });

  it('a stale answer never overwrites a newer query', async () => {
    let resolveFirst!: (v: ReturnType<typeof hit>[]) => void;
    const search = vi.fn((q: string) => q === 'first'
      ? new Promise<ReturnType<typeof hit>[]>((r) => { resolveFirst = r; })
      : Promise.resolve([hit(q)]));
    const { s } = make(search as never);
    const p1 = s.submit('first');
    await s.submit('second');
    resolveFirst([hit('first')]);
    await p1;
    expect(s.current).toMatchObject({ status: 'results', query: 'second' });
  });

  it('typing after a request started drops its answer', async () => {
    let resolveIt!: (v: ReturnType<typeof hit>[]) => void;
    const search = vi.fn(() => new Promise<ReturnType<typeof hit>[]>((r) => { resolveIt = r; }));
    const { s } = make(search as never);
    const p = s.submit('Tokyo');
    expect(s.current.status).toBe('loading');
    s.input('');
    resolveIt([hit('Tokyo')]);
    await p;
    expect(s.current.status).toBe('idle');
  });

  it('empty and unusable answers say "empty"', async () => {
    const { s } = make(vi.fn(async () => []));
    await s.submit('zzzzzz');
    expect(s.current.status).toBe('empty');
    const bad = make(vi.fn(async () => [{ lat: 'x', lon: 'y', display_name: 'A, B' }]));
    await bad.s.submit('abc');
    expect(bad.s.current.status).toBe('empty');
  });

  it('a malformed answer (not an array) is an empty result, not a crash', async () => {
    const { s } = make(vi.fn(async () => ({ nope: true })) as never);
    await s.submit('abc');
    expect(s.current.status).toBe('empty');
  });

  it('geocoder down: error state with a way out, and a retry works', async () => {
    const search = vi.fn().mockRejectedValueOnce(new Error('Geocoder error 502')).mockResolvedValue([hit('Kobe')]);
    const { s } = make(search as never);
    await s.submit('Kobe');
    expect(s.current).toEqual({ status: 'error', query: 'Kobe', message: SEARCH_ERROR_MESSAGE });
    await s.submit('Kobe');
    expect(s.current.status).toBe('results');
  });

  it('errors are not cached', async () => {
    const search = vi.fn().mockRejectedValue(new Error('x'));
    const { s } = make(search as never);
    await s.submit('Kobe');
    await s.submit('Kobe');
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('a pasted Google Maps link is resolved locally, without calling the geocoder', async () => {
    const { s, search } = make();
    s.input('https://www.google.com/maps/place/Kinkaku-ji/@35.0394,135.7292,17z');
    expect(s.current).toMatchObject({ status: 'link', lat: 35.0394, lng: 135.7292 });
    s.input('https://www.google.com/maps?q=-34.6037,-58.3816');
    expect(s.current).toMatchObject({ status: 'link', lat: -34.6037, lng: -58.3816 });
    s.input('https://www.google.com/maps/place/Somewhere');
    expect(s.current.status).toBe('badlink');
    await vi.advanceTimersByTimeAsync(5000);
    expect(search).not.toHaveBeenCalled();
  });

  it('link with out-of-range coordinates is rejected', () => {
    const { s } = make();
    s.input('https://www.google.com/maps/@95.0,200.0,13z');
    expect(s.current.status).toBe('badlink');
  });

  it('hostile text is just text', async () => {
    const { s } = make(vi.fn(async () => [{ lat: '1', lon: '2', display_name: '<script>alert(1)</script>, Evil' }]) as never);
    await s.submit('<script>');
    expect(s.current).toMatchObject({ status: 'results', places: [{ name: '<script>alert(1)</script>' }] });
  });

  it('bounds its cache', async () => {
    const search = vi.fn(async (q: string) => [hit(q)]);
    const s = new PlaceSearch({ search, mode: 'proxy', cacheSize: 2 });
    await s.submit('aaa'); await s.submit('bbb'); await s.submit('ccc');
    await s.submit('aaa'); // evicted: searched again
    expect(search).toHaveBeenCalledTimes(4);
  });

  it('reset clears the results', async () => {
    const { s } = make();
    await s.submit('Kyoto');
    s.reset();
    expect(s.current.status).toBe('idle');
  });
});
