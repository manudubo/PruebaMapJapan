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
