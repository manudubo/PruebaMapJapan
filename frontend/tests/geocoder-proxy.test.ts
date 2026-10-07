import { describe, it, expect, vi, afterEach } from 'vitest';

// SEC-18: with a backend configured, geocoding goes through /api/geocode with
// the user's bearer token; only demo-only builds call Nominatim directly.

vi.mock('@/auth/keycloak', () => ({
  getToken: vi.fn(async () => 'access-token-123'),
  isAuthenticated: () => true,
  login: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function load(apiUrl: string | undefined) {
  if (apiUrl !== undefined) vi.stubEnv('VITE_API_URL', apiUrl);
  return import('@/modules/geocoder');
}

describe('geocoderMode', () => {
  it.each([
    [undefined, 'direct'],
    ['', 'direct'],
    ['   ', 'direct'],
    ['https://box.tail1234.ts.net/api', 'proxy'],
    ['https://api.example.org/api', 'proxy'],
    ['/api', 'proxy'],
  ])('VITE_API_URL=%j → %s', async (value, mode) => {
    const { geocoderMode } = await import('@/modules/geocoder');
    expect(geocoderMode(value)).toBe(mode);
  });
});

describe('searchNominatim with a backend', () => {
  it('calls the API proxy with the bearer token and never nominatim.openstreetmap.org', async () => {
    const { searchNominatim } = await load('https://box.tail1234.ts.net/api');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [{ lat: '1', lon: '2', display_name: 'X' }] }), { status: 200 }),
    );
    const out = await searchNominatim('Fushimi Inari & Kyoto');
    expect(out).toEqual([{ lat: '1', lon: '2', display_name: 'X' }]);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://box.tail1234.ts.net/api/geocode');
    expect(u.searchParams.get('q')).toBe('Fushimi Inari & Kyoto');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer access-token-123');
    expect(fetchSpy.mock.calls.some(([x]) => String(x).includes('nominatim.openstreetmap.org'))).toBe(false);
  });

  it.each([429, 502, 503])('surfaces a %i from the proxy as an error', async (status) => {
    const { searchNominatim } = await load('https://api.example.org/api');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"success":false}', { status }));
    await expect(searchNominatim('Nara')).rejects.toThrow(String(status));
  });

  it('rejects a malformed proxy body', async () => {
    const { searchNominatim } = await load('https://api.example.org/api');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"success":true,"data":"nope"}', { status: 200 }));
    await expect(searchNominatim('Nara')).rejects.toThrow();
  });
});

describe('searchNominatim in a demo-only build', () => {
  it('calls Nominatim directly without credentials', async () => {
    const { searchNominatim } = await load('');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    await searchNominatim('Kyoto');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).hostname).toBe('nominatim.openstreetmap.org');
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });
});
