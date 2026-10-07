export interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

/**
 * SEC-18: with a backend (VITE_API_URL set, absolute or a same-origin path)
 * the editor geocodes through GET /api/geocode, which sends the OSM-required
 * identifying User-Agent, holds the upstream to 1 request/second and caches.
 * Only a demo-only build (no backend) calls Nominatim from the browser, and
 * only that build's CSP allows nominatim.openstreetmap.org (cspPlugin.ts).
 */
export function geocoderMode(raw: unknown = import.meta.env['VITE_API_URL']): 'proxy' | 'direct' {
  return typeof raw === 'string' && raw.trim() !== '' ? 'proxy' : 'direct';
}

/**
 * Search places by name.
 * IMPORTANT: Only call on explicit button click — never on keypress (OSM rate limit: 1 req/s).
 * No custom User-Agent from the browser: it is a forbidden header in fetch and
 * is silently replaced by the browser's own; the proxy sets the real one.
 */
export async function searchNominatim(query: string): Promise<NominatimResult[]> {
  if (geocoderMode() === 'proxy') {
    // Loaded lazily so the demo-only path does not pull in the API client.
    const [{ apiUrl }, { getToken }] = await Promise.all([import('@/api/client'), import('@/auth/keycloak')]);
    const token = await getToken();
    const res = await fetch(apiUrl(`/geocode?q=${encodeURIComponent(query)}`), {
      headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'es,en' },
    });
    if (!res.ok) throw new Error(`Geocoder error ${res.status}`);
    const body = (await res.json()) as { success?: boolean; data?: NominatimResult[] };
    if (!body.success || !Array.isArray(body.data)) throw new Error('Geocoder error');
    return body.data;
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '5');

  const res = await fetch(url.toString(), {
    headers: {
      'Accept-Language': 'es,en',
    },
  });

  if (!res.ok) throw new Error(`Nominatim error ${res.status}`);
  return res.json() as Promise<NominatimResult[]>;
}

/**
 * Detect if input string is a Google Maps URL.
 */
export function isGoogleMapsUrl(input: string): boolean {
  return (
    input.includes('google.com/maps') ||
    input.includes('maps.google.com') ||
    input.includes('goo.gl/maps')
  );
}

/**
 * Extract lat/lng from a Google Maps URL.
 * Handles three patterns:
 *  1. /@lat,lng,zoom  (place URL)
 *  2. ?q=lat,lng       (query URL)
 *  3. !3d<lat>!4d<lng> (embedded data URL)
 * Returns null if no coordinate pattern is found.
 */
export function extractCoordsFromGoogleMapsUrl(
  url: string,
): { lat: string; lng: string } | null {
  const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) return { lat: atMatch[1], lng: atMatch[2] };

  const qMatch = url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch) return { lat: qMatch[1], lng: qMatch[2] };

  const dataMatch = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (dataMatch) return { lat: dataMatch[1], lng: dataMatch[2] };

  return null;
}
