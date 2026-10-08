import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { POLICIES, rateLimit } from '../middleware/rate-limit';
import { isDevelopment } from '../config/environment';
import { log } from '../observability/logger';
import type { ContextVariables, Env } from '../types';

/**
 * GET /api/geocode?q=… — Nominatim proxy (SEC-18).
 *
 * Why a proxy: the OSM Nominatim usage policy asks for an identifying
 * User-Agent with contact details (browsers cannot set one), at most 1 request
 * per second for the whole application, and caching of results. Calling it
 * from every visitor's browser also leaked each search plus the visitor's IP
 * to a third party.
 *
 *  - authenticated users only (it is an editor feature; an open relay would
 *    let anyone spend our Nominatim quota and get our UA banned);
 *  - per-IP and per-user rate limits (POLICIES.geocode*);
 *  - a process-wide 1 req/s gate to the upstream; callers wait for a slot up
 *    to MAX_QUEUE_WAIT_MS, then get 429 geocoder_busy;
 *  - normalised query cache (24 h, bounded LRU) — repeated lookups cost nothing;
 *  - the upstream answer is reduced to {lat, lon, display_name}.
 *
 * Config: NOMINATIM_CONTACT (email or URL, required outside development),
 * NOMINATIM_URL (default the public instance; https only outside development),
 * NOMINATIM_USER_AGENT (optional product token(s), e.g. "TravelMap-selfhost/1.0";
 * default DEFAULT_USER_AGENT_PRODUCT; an invalid value falls back to the default
 * and is refused at boot by the Node server, node/config.ts).
 */
export const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1000;
const MAX_QUEUE_WAIT_MS = 5000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 1000;
const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_UPSTREAM_BYTES = 256 * 1024;
const MAX_RESULTS = 5;

export interface GeocodeResult {
  lat: string;
  lon: string;
  display_name: string;
}

const cache = new Map<string, { at: number; results: GeocodeResult[] }>();
let nextSlotAt = 0;
let clock: () => number = () => Date.now();
let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Test hook. */
export function __resetGeocoderForTests(opts: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
  cache.clear();
  nextSlotAt = 0;
  clock = opts.now ?? (() => Date.now());
  sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Normalised query, or null when unusable. */
export function normaliseQuery(raw: string | undefined): string | null {
  if (typeof raw !== 'string' || raw.length > 1000 || CONTROL.test(raw)) return null;
  const q = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (q.length < 2 || q.length > 200 || CONTROL.test(q)) return null;
  return q;
}

/** Only simple language ranges pass through; anything else becomes the default. */
export function acceptLanguage(raw: string | undefined): string {
  const v = raw?.trim() ?? '';
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?(\s*;\s*q=[01](\.\d{1,3})?)?(\s*,\s*[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?(\s*;\s*q=[01](\.\d{1,3})?)?){0,5}$/.test(v) &&
    v.length <= 64
    ? v
    : 'es,en';
}

export const DEFAULT_USER_AGENT_PRODUCT = 'TravelMap-PruebaMapJapan/1.0';
const TOKEN = "[A-Za-z0-9!#$%&'*+.^_`|~-]+";
const PRODUCTS = new RegExp(`^${TOKEN}(/${TOKEN})?( ${TOKEN}(/${TOKEN})?){0,2}$`);

/** NOMINATIM_USER_AGENT as product token(s) (RFC 9110 `product`, up to 3), or null when unusable. */
export function userAgentProduct(raw: string | undefined): string | null {
  const v = raw?.trim() ?? '';
  return v.length > 0 && v.length <= 100 && PRODUCTS.test(v) ? v : null;
}

export function userAgent(contact: string, product?: string): string {
  return `${userAgentProduct(product) ?? DEFAULT_USER_AGENT_PRODUCT} (+${contact})`;
}

function upstreamUrl(env: Env): URL | null {
  const raw = env.NOMINATIM_URL?.trim() || DEFAULT_NOMINATIM_URL;
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && isDevelopment(env))) return u;
  } catch {
    /* fallthrough */
  }
  return null;
}

function sanitise(data: unknown): GeocodeResult[] | null {
  if (!Array.isArray(data)) return null;
  const out: GeocodeResult[] = [];
  for (const item of data.slice(0, MAX_RESULTS)) {
    if (typeof item !== 'object' || item === null) continue;
    const { lat, lon, display_name } = item as Record<string, unknown>;
    const latN = Number(lat);
    const lonN = Number(lon);
    if (typeof lat !== 'string' || typeof lon !== 'string' || typeof display_name !== 'string') continue;
    if (!Number.isFinite(latN) || !Number.isFinite(lonN) || Math.abs(latN) > 90 || Math.abs(lonN) > 180) continue;
    out.push({ lat, lon, display_name: display_name.slice(0, 500) });
  }
  return out;
}

async function takeUpstreamSlot(): Promise<boolean> {
  const now = clock();
  const slot = Math.max(now, nextSlotAt);
  if (slot - now > MAX_QUEUE_WAIT_MS) return false;
  nextSlotAt = slot + MIN_INTERVAL_MS;
  if (slot > now) await sleep(slot - now);
  return true;
}

const geocode = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

geocode.use('*', rateLimit(POLICIES.geocodePerIp), authMiddleware, rateLimit(POLICIES.geocodePerUser));

geocode.get('/', async (c) => {
  const q = normaliseQuery(c.req.query('q'));
  if (!q) return c.json({ success: false, error: 'invalid_query' }, 400);

  const contact = c.env.NOMINATIM_CONTACT?.trim() || (isDevelopment(c.env) ? 'development@localhost' : '');
  const upstream = upstreamUrl(c.env);
  if (!contact || !upstream) {
    log.error('geocode.not_configured', { missing: !contact ? 'NOMINATIM_CONTACT' : 'NOMINATIM_URL (https)' });
    return c.json({ success: false, error: 'geocoder_not_configured' }, 503);
  }

  const lang = acceptLanguage(c.req.header('accept-language'));
  const key = `${lang}|${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && clock() - hit.at < CACHE_TTL_MS) {
    cache.delete(key); // refresh LRU position
    cache.set(key, hit);
    c.header('Cache-Control', 'private, max-age=3600');
    return c.json({ success: true, data: hit.results });
  }

  if (!(await takeUpstreamSlot())) {
    c.header('Retry-After', '5');
    return c.json({ success: false, error: 'geocoder_busy' }, 429);
  }

  const url = new URL(upstream.href);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', String(MAX_RESULTS));
  let results: GeocodeResult[] | null = null;
  try {
    const res = await fetch(url.href, {
      headers: { 'User-Agent': userAgent(contact, c.env.NOMINATIM_USER_AGENT), 'Accept-Language': lang, Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      redirect: 'error',
    });
    if (res.ok) {
      const text = await res.text();
      if (text.length <= MAX_UPSTREAM_BYTES) results = sanitise(JSON.parse(text));
    } else {
      log.warn('geocode.upstream_status', { status: res.status });
    }
  } catch (err) {
    log.warn('geocode.upstream_error', { error: err });
  }
  if (!results) return c.json({ success: false, error: 'geocoder_unavailable' }, 502);

  cache.set(key, { at: clock(), results });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  c.header('Cache-Control', 'private, max-age=3600');
  return c.json({ success: true, data: results });
});

export default geocode;
