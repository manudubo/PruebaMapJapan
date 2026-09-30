import type { Page } from '@playwright/test';
import * as path from 'path';

const LEAFLET_DIST = path.join(__dirname, '../../../node_modules/leaflet/dist');

// 1x1 transparent PNG
const BLANK_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Make map pages hermetic: Leaflet's CSS/JS come from unpkg and tiles from
 * CartoDB. Serving them locally keeps layout identical to production (tiles are
 * positioned by leaflet.css) without depending on the network.
 */
export async function stubMapThirdParty(page: Page): Promise<void> {
  await page.route('**/*.basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_TILE }),
  );
  await page.route('https://unpkg.com/leaflet@*/dist/leaflet.css', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', path: path.join(LEAFLET_DIST, 'leaflet.css') }),
  );
  await page.route('https://unpkg.com/leaflet@*/dist/leaflet.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', path: path.join(LEAFLET_DIST, 'leaflet.js') }),
  );
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );
}

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Mock headline - Mock Source</title><link>https://example.com/news/1</link><pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate><source>Mock Source</source></item>
</channel></rss>`;

/**
 * Answer the weather (Open-Meteo) and news (allorigins / corsproxy RSS proxy)
 * widget requests with valid payloads, so specs can assert the widgets render.
 * Routing happens at the network layer, after the page's CSP has allowed the
 * request, so the CSP stays enforced.
 */
export async function stubWidgetApis(page: Page): Promise<void> {
  const days = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'];
  const cors = { 'access-control-allow-origin': '*' };
  await page.route('https://api.open-meteo.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: cors,
      body: JSON.stringify({
        current: { temperature_2m: 12.4, weather_code: 1 },
        daily: {
          time: days,
          weather_code: days.map(() => 1),
          temperature_2m_max: days.map(() => 15),
          temperature_2m_min: days.map(() => 5),
        },
      }),
    }),
  );
  await page.route('https://api.allorigins.win/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ contents: RSS }) }),
  );
  await page.route('https://corsproxy.io/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/xml', headers: cors, body: RSS }),
  );
}
