export interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

/**
 * Search Nominatim for a place name.
 * IMPORTANT: Only call on explicit button click — never on keypress (OSM rate limit: 1 req/s).
 * No custom User-Agent: it is a forbidden header in browser fetch and is
 * silently replaced by the browser's own. From a browser, Nominatim's usage
 * policy is satisfied by the browser User-Agent plus the page's Referer.
 * (The "403 without User-Agent" behaviour only applies to server-side fetch.)
 */
export async function searchNominatim(query: string): Promise<NominatimResult[]> {
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
