/**
 * State machine behind the place-search box (destinations and activities):
 * debounced type-ahead, a client cache, stale-answer protection, and the three
 * ways a place can come in — a geocoder hit, a pasted Google Maps link, or a
 * point picked on the map.
 *
 * Rate limits: the proxy answers 20 searches/minute/user (1 req/s upstream), so
 * type-ahead waits for a pause (650 ms), needs 3+ characters, reuses answers it
 * already has, and the demo build (browser -> Nominatim directly, `direct`
 * mode) only searches on an explicit Enter / button press.
 */

import {
  extractCoordsFromGoogleMapsUrl,
  isGoogleMapsUrl,
  searchNominatim,
  geocoderMode,
  type NominatimResult,
} from '@/modules/geocoder';
import { hitToPlace, type Place } from './model';

export type SearchState =
  | { status: 'idle' }
  /** Typed, but too short to search yet. */
  | { status: 'short' }
  | { status: 'loading'; query: string }
  | { status: 'results'; query: string; places: Place[] }
  | { status: 'empty'; query: string }
  | { status: 'error'; query: string; message: string }
  /** A pasted Google Maps link with coordinates in it. */
  | { status: 'link'; query: string; lat: number; lng: number }
  /** A pasted link we could not read coordinates from. */
  | { status: 'badlink'; query: string };

export interface PlaceSearchOptions {
  search?: (q: string) => Promise<NominatimResult[]>;
  debounceMs?: number;
  minChars?: number;
  mode?: 'proxy' | 'direct';
  cacheSize?: number;
}

export const SEARCH_ERROR_MESSAGE = "Couldn't search places right now. Check your connection and try again, or paste a Google Maps link.";

function normalize(q: string): string {
  return q.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export class PlaceSearch {
  private state: SearchState = { status: 'idle' };
  private listeners = new Set<(s: SearchState) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private cache = new Map<string, Place[]>();
  private readonly search: (q: string) => Promise<NominatimResult[]>;
  private readonly debounceMs: number;
  private readonly minChars: number;
  private readonly mode: 'proxy' | 'direct';
  private readonly cacheSize: number;

  constructor(opts: PlaceSearchOptions = {}) {
    this.search = opts.search ?? searchNominatim;
    this.debounceMs = opts.debounceMs ?? 650;
    this.minChars = opts.minChars ?? 3;
    this.mode = opts.mode ?? geocoderMode();
    this.cacheSize = opts.cacheSize ?? 50;
  }

  get current(): SearchState {
    return this.state;
  }

  subscribe(fn: (s: SearchState) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private set(state: SearchState): void {
    this.state = state;
    for (const fn of this.listeners) fn(state);
  }

  private cancelTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /** Typing: updates the state, searches after a pause (proxy mode only). */
  input(text: string): void {
    this.cancelTimer();
    const q = text.trim();
    this.seq += 1; // any answer still in flight is now stale
    if (!q) { this.set({ status: 'idle' }); return; }
    if (isGoogleMapsUrl(q)) { this.resolveLink(q); return; }
    if (q.length < this.minChars) { this.set({ status: 'short' }); return; }
    const hit = this.cache.get(normalize(q));
    if (hit) { this.set(hit.length ? { status: 'results', query: q, places: hit } : { status: 'empty', query: q }); return; }
    if (this.mode === 'direct') { this.set({ status: 'short' }); return; }
    this.timer = setTimeout(() => { this.timer = null; void this.run(q); }, this.debounceMs);
  }

  /** Enter / the Search button: search now, whatever the mode. */
  submit(text: string): Promise<void> {
    this.cancelTimer();
    const q = text.trim();
    this.seq += 1;
    if (!q) { this.set({ status: 'idle' }); return Promise.resolve(); }
    if (isGoogleMapsUrl(q)) { this.resolveLink(q); return Promise.resolve(); }
    if (q.length < 2) { this.set({ status: 'short' }); return Promise.resolve(); }
    return this.run(q);
  }

  /** Forget the current results (a place was chosen). */
  reset(): void {
    this.cancelTimer();
    this.seq += 1;
    this.set({ status: 'idle' });
  }

  private resolveLink(q: string): void {
    const c = extractCoordsFromGoogleMapsUrl(q);
    const lat = c ? Number(c.lat) : NaN;
    const lng = c ? Number(c.lng) : NaN;
    if (c && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      this.set({ status: 'link', query: q, lat, lng });
    } else {
      this.set({ status: 'badlink', query: q });
    }
  }

  private async run(q: string): Promise<void> {
    const key = normalize(q);
    const mine = ++this.seq;
    const cached = this.cache.get(key);
    if (cached) {
      this.set(cached.length ? { status: 'results', query: q, places: cached } : { status: 'empty', query: q });
      return;
    }
    this.set({ status: 'loading', query: q });
    try {
      const raw = await this.search(q);
      if (mine !== this.seq) return;
      const places = (Array.isArray(raw) ? raw : []).map(hitToPlace).filter((p): p is Place => p !== null);
      this.remember(key, places);
      this.set(places.length ? { status: 'results', query: q, places } : { status: 'empty', query: q });
    } catch {
      if (mine !== this.seq) return;
      this.set({ status: 'error', query: q, message: SEARCH_ERROR_MESSAGE });
    }
  }

  private remember(key: string, places: Place[]): void {
    this.cache.set(key, places);
    if (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }
}
