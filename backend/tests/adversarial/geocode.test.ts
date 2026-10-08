/**
 * Adversarial: GET /api/geocode (Nominatim proxy, SEC-18) through the real app
 * and real JWT verification; only the network edges are faked.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/index';
import { __resetGeocoderForTests, userAgent } from '../../src/routes/geocode';
import { POLICIES, __resetRateLimitsForTests, __setRateLimitingEnabledForTests } from '../../src/middleware/rate-limit';
import { createSigner, installFakeNetwork, makeEnv, makeUser, type Signer } from './harness';
import type { Env } from '../../src/types';

let signer: Signer;
let token: string;
let upstream: { url: URL; headers: Headers }[];
let reply: () => Response | Promise<Response>;
let waits: number[];
let now: number;

const env = (extra: Record<string, string> = {}): Env =>
  makeEnv('postgresql://unused@127.0.0.1:1/none', { ENVIRONMENT: 'production', NOMINATIM_CONTACT: 'owner@example.org', ...extra });

const OK_BODY = [
  { lat: '35.0116', lon: '135.7681', display_name: 'Kyoto, Japan', osm_id: 1, extratags: { secret: 1 } },
  { lat: '999', lon: '1', display_name: 'bad coords' },
  { lat: 35, lon: '1', display_name: 'number lat' },
  { lat: '34.98', lon: '135.75', display_name: 'Kyoto Station' },
];

async function geocode(q: string | null, opts: { token?: string | null; env?: Env; headers?: Record<string, string> } = {}) {
  const url = q === null ? '/api/geocode' : `/api/geocode?q=${encodeURIComponent(q)}`;
  const headers: Record<string, string> = { ...opts.headers };
  const t = opts.token === undefined ? token : opts.token;
  if (t) headers['Authorization'] = `Bearer ${t}`;
  const res = await app.request(url, { headers }, opts.env ?? env());
  return { status: res.status, body: (await res.json()) as Record<string, any>, headers: res.headers };
}

beforeAll(async () => {
  signer = await createSigner();
});

beforeEach(async () => {
  installFakeNetwork([signer]);
  const harnessFetch = globalThis.fetch;
  upstream = [];
  reply = () => new Response(JSON.stringify(OK_BODY), { headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (u.hostname === 'nominatim.openstreetmap.org' || u.hostname === 'geo.internal') {
      upstream.push({ url: u, headers: new Headers(init?.headers) });
      return reply();
    }
    return harnessFetch(input, init);
  });
  waits = [];
  now = 1_000_000;
  __resetGeocoderForTests({
    now: () => now,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    },
  });
  token = (await makeUser(signer)).token;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __setRateLimitingEnabledForTests(false);
});

describe('GET /api/geocode', () => {
  it('requires a valid access token; no upstream call without one', async () => {
    expect((await geocode('Kyoto', { token: null })).status).toBe(401);
    expect((await geocode('Kyoto', { token: 'x.y.z' })).status).toBe(401);
    expect(upstream).toHaveLength(0);
  });

  it('proxies with an identifying User-Agent, strips the result to lat/lon/display_name, drops bad rows', async () => {
    const r = await geocode('Kyoto');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([
      { lat: '35.0116', lon: '135.7681', display_name: 'Kyoto, Japan' },
      { lat: '34.98', lon: '135.75', display_name: 'Kyoto Station' },
    ]);
    expect(upstream).toHaveLength(1);
    const { url, headers } = upstream[0]!;
    expect(headers.get('User-Agent')).toBe(userAgent('owner@example.org'));
    expect(headers.get('Accept-Language')).toBe('es,en');
    expect(headers.get('Authorization')).toBeNull(); // the user's token never leaves
    expect(url.searchParams.get('q')).toBe('Kyoto');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('NOMINATIM_USER_AGENT names the deployment in the User-Agent; an unsafe value falls back to the default', async () => {
    await geocode('Osaka', { env: env({ NOMINATIM_USER_AGENT: 'TravelMap-selfhost/1.0' }) });
    expect(upstream.at(-1)!.headers.get('User-Agent')).toBe('TravelMap-selfhost/1.0 (+owner@example.org)');
    for (const bad of ['evil\r\nX-Injected: 1', 'a (b)', 'x'.repeat(101), ' ']) {
      expect(userAgent('owner@example.org', bad)).toBe(userAgent('owner@example.org'));
    }
    expect(userAgent('owner@example.org')).toBe('TravelMap-PruebaMapJapan/1.0 (+owner@example.org)');
  });

  it('caches normalised queries: case/whitespace/NFKC variants hit the upstream once', async () => {
    for (const q of ['Kyoto Station', '  kyoto   station ', 'KYOTO STATION', 'Ｋｙｏｔｏ Station']) {
      expect((await geocode(q)).status).toBe(200);
    }
    expect(upstream).toHaveLength(1);
  });

  it('process-wide 1 request/second to the upstream, even for concurrent distinct queries', async () => {
    const results = await Promise.all(['a1', 'b2', 'c3', 'd4'].map((q) => geocode(`place ${q}`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(upstream).toHaveLength(4);
    expect(waits.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(3000);
  });

  it('a backlog beyond 5 s answers 429 geocoder_busy instead of queueing forever', async () => {
    // Deterministic: the injected clock never moves and every wait is parked until we
    // release it, so nothing depends on elapsed time or on how fast the six requests
    // get through auth under suite load. The seventh is sent only after the six hold
    // their slots (slot 0 goes straight upstream, slots 1-5 = 1..5 s wait), so it
    // must be the one that sees a 6 s backlog.
    const parked: Array<{ ms: number; release: () => void }> = [];
    __resetGeocoderForTests({
      now: () => now,
      sleep: (ms) => new Promise<void>((release) => parked.push({ ms, release })),
    });
    const pending = Array.from({ length: 6 }, (_, i) => geocode(`busy ${i}`));
    await vi.waitFor(() => {
      expect(parked).toHaveLength(5);
      expect(upstream).toHaveLength(1);
    });
    expect(parked.map((p) => p.ms)).toEqual([1000, 2000, 3000, 4000, 5000]);

    const seventh = await geocode('busy 7');
    expect(seventh.status).toBe(429);
    expect(seventh.body.error).toBe('geocoder_busy');
    expect(seventh.headers.get('Retry-After')).toBe('5');
    expect(upstream).toHaveLength(1); // the refused request never reached Nominatim

    // The queued six were not dropped: once their waits end they are served.
    parked.forEach((p) => p.release());
    expect((await Promise.all(pending)).map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(upstream).toHaveLength(6);
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['one char', 'a'],
    ['too long', 'x'.repeat(201)],
    ['control char', 'Kyoto\u0000'],
    ['newline', 'Kyoto\r\nX-Injected: 1'],
  ])('%s query → 400 and no upstream call', async (_l, q) => {
    const r = await geocode(q);
    expect(r.status).toBe(400);
    expect(upstream).toHaveLength(0);
  });

  it('parameter smuggling stays inside q', async () => {
    await geocode('Kyoto&format=xml&limit=1000&email=x');
    const u = upstream[0]!.url;
    expect(u.searchParams.getAll('format')).toEqual(['jsonv2']);
    expect(u.searchParams.getAll('limit')).toEqual(['5']);
    expect(u.searchParams.get('q')).toBe('Kyoto&format=xml&limit=1000&email=x');
  });

  it('hostile Accept-Language falls back to the default', async () => {
    await geocode('Osaka', { headers: { 'Accept-Language': 'en\r\nX: y' } }).catch(() => undefined);
    await geocode('Nara', { headers: { 'Accept-Language': 'x'.repeat(500) } });
    expect(upstream.at(-1)!.headers.get('Accept-Language')).toBe('es,en');
    await geocode('Kobe', { headers: { 'Accept-Language': 'ja-JP, en;q=0.5' } });
    expect(upstream.at(-1)!.headers.get('Accept-Language')).toBe('ja-JP, en;q=0.5');
  });

  it.each([
    ['500', () => new Response('oops', { status: 500 })],
    ['not JSON', () => new Response('<html>', { status: 200 })],
    ['not an array', () => new Response('{"a":1}', { status: 200 })],
    ['huge body', () => new Response(`[${'{"lat":"1","lon":"1","display_name":"x"},'.repeat(10_000)}{}]`, { status: 200 })],
    ['network error', () => Promise.reject(new TypeError('fetch failed'))],
  ])('upstream %s → 502 geocoder_unavailable, not cached', async (_l, make) => {
    reply = make as () => Response;
    expect((await geocode('Hakone')).status).toBe(502);
    reply = () => new Response(JSON.stringify(OK_BODY), { status: 200 });
    expect((await geocode('Hakone')).status).toBe(200);
    expect(upstream).toHaveLength(2);
  });

  it('production without NOMINATIM_CONTACT, or with an http upstream → 503, nothing sent', async () => {
    expect((await geocode('Kyoto', { env: env({ NOMINATIM_CONTACT: '' }) })).status).toBe(503);
    expect((await geocode('Kyoto', { env: env({ NOMINATIM_URL: 'http://geo.internal/search' }) })).status).toBe(503);
    expect(upstream).toHaveLength(0);
  });

  it('a self-hosted https Nominatim can be configured', async () => {
    const r = await geocode('Kyoto', { env: env({ NOMINATIM_URL: 'https://geo.internal/search' }) });
    expect(r.status).toBe(200);
    expect(upstream[0]!.url.origin).toBe('https://geo.internal');
  });

  it('per-user rate limit (limits enabled)', async () => {
    __setRateLimitingEnabledForTests(true);
    __resetRateLimitsForTests();
    const statuses: number[] = [];
    for (let i = 0; i < POLICIES.geocodePerUser.limit + 3; i++) statuses.push((await geocode(`town ${i}`)).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(POLICIES.geocodePerUser.limit);
    expect(statuses.slice(-3)).toEqual([429, 429, 429]);
  });
});
