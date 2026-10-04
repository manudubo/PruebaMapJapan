import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchNominatim } from '@/modules/geocoder';

describe('searchNominatim (BUG-12)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not set a User-Agent header (forbidden header, ignored by browsers)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await searchNominatim('Kyoto');

    const init = fetchSpy.mock.calls[0][1];
    const headers = new Headers(init?.headers);
    expect(headers.has('User-Agent')).toBe(false);
    expect(headers.get('Accept-Language')).toBe('es,en');
  });

  it('queries Nominatim with the search term', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('[]', { status: 200 }),
    );
    await searchNominatim('Fushimi Inari');
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.hostname).toBe('nominatim.openstreetmap.org');
    expect(url.searchParams.get('q')).toBe('Fushimi Inari');
  });
});
