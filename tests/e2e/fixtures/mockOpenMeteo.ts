import type { Page, Route } from '@playwright/test';
import { isoFromToday } from './mockTripView';

/**
 * Open-Meteo (https://api.open-meteo.com/v1/forecast) for the trip weather specs. The answer
 * follows the request like the real API: `start_date`/`end_date` give those days, otherwise
 * `forecast_days` days from today.
 */
export type MeteoBehaviour =
  | 'ok'
  | 'http500'
  | 'http429'
  | 'malformed' // 200 with a body that is not JSON
  | 'garbage' // 200 JSON of the wrong shape (the demo specs' {"foo":1})
  | 'empty' // 200 `{}`
  | 'no-days' // right shape, zero days
  | 'hostile' // right shape, markup/script in every string
  | 'hang' // never answers (timeout)
  | 'abort'; // connection fails (offline / blocked)

export interface OpenMeteoMock {
  /** Every request that reached the mock, parsed. */
  requests: URL[];
  set(behaviour: MeteoBehaviour): void;
}

const CODES = [0, 2, 61, 71, 95];

function daysFor(url: URL): string[] {
  const start = url.searchParams.get('start_date');
  const end = url.searchParams.get('end_date');
  if (start && end) {
    const out: string[] = [];
    for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`) && out.length < 16; t += 86_400_000) {
      out.push(new Date(t).toISOString().slice(0, 10));
    }
    return out;
  }
  const n = Number(url.searchParams.get('forecast_days') ?? 5);
  return Array.from({ length: n }, (_, i) => isoFromToday(i));
}

export function forecastBody(url: URL, hostile = false): Record<string, unknown> {
  const time = daysFor(url);
  return {
    latitude: Number(url.searchParams.get('latitude')),
    longitude: Number(url.searchParams.get('longitude')),
    current: { time: '2026-01-01T12:00', temperature_2m: 12.4, weather_code: 2 },
    daily: {
      time,
      weather_code: time.map((_, i) => CODES[i % CODES.length]),
      temperature_2m_max: time.map((_, i) => 15 + i),
      temperature_2m_min: time.map((_, i) => 5 + i),
    },
    ...(hostile ? { reason: '<img src=x onerror="window.__pwned=1">', daily_units: { time: '<script>window.__pwned=2</script>' } } : {}),
  };
}

const cors = { 'access-control-allow-origin': '*' };

export async function mockOpenMeteo(page: Page, initial: MeteoBehaviour = 'ok'): Promise<OpenMeteoMock> {
  let behaviour = initial;
  const requests: URL[] = [];

  await page.route('https://api.open-meteo.com/**', async (route: Route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    switch (behaviour) {
      case 'ok': return json(200, forecastBody(url));
      case 'hostile': return json(200, { ...forecastBody(url, true) });
      case 'http500': return json(500, { error: true, reason: 'boom' });
      case 'http429': return json(429, { error: true, reason: 'Too many requests' });
      case 'malformed': return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"daily": {"time": [' });
      case 'garbage': return json(200, { foo: 1 });
      case 'empty': return json(200, {});
      case 'no-days': return json(200, { current: { temperature_2m: 1, weather_code: 0 }, daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] } });
      case 'hang': return; // never fulfilled
      case 'abort': return route.abort('internetdisconnected');
    }
  });

  return { requests, set: (b) => { behaviour = b; } };
}
