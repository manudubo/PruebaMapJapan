import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { THEME_CONFIG } from '@/modules/theme';
import { classifyTile } from '../../build/tileGuard';

/**
 * OPT-IN live tile check (needs internet; NOT part of `npm run test:run` or CI):
 *
 *   npm run check:tiles --workspace=frontend
 *   # behind an HTTP proxy, Node's fetch needs: NODE_USE_ENV_PROXY=1 npm run check:tiles ...
 *
 * Downloads ONE tile per theme from the configured provider and fails if it is a
 * placeholder ("API KEY REQUIRED", "Access blocked") instead of map imagery. One
 * request per theme, an identifying User-Agent and a Referer keep this within the
 * OSM tile usage policy; do not loop it or add zoom levels.
 */

// A detailed land tile (Kyoto, z12): a real tile is never one flat colour.
const TILE = { z: 12, x: 3592, y: 1622 };
const PLACEHOLDERS = ['carto-apikey-light.png', 'carto-apikey-dark.png', 'osm-blocked-403.png'].map((f) =>
  readFileSync(resolve(__dirname, '../fixtures/tiles', f)),
);

function tileUrl(template: string): string {
  return template
    .replace('{s}', 'a')
    .replace('{z}', String(TILE.z))
    .replace('{x}', String(TILE.x))
    .replace('{y}', String(TILE.y))
    .replace('{r}', '');
}

describe('live tile provider (opt-in)', () => {
  it.each(Object.entries(THEME_CONFIG))('%s theme serves real map imagery', async (theme, cfg) => {
    const url = tileUrl(cfg.tileUrl);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'TravelMap-tile-check/1.0 (+https://github.com/manudubo/PruebaMapJapan)',
        Referer: 'https://manudubo.github.io/PruebaMapJapan/',
      },
    });
    expect(res.status, `${theme}: ${url}`).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/^image\//);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const verdict = classifyTile(bytes, PLACEHOLDERS);
    expect(verdict, `${theme}: ${url} (${bytes.length} bytes)`).toMatchObject({ ok: true });
  }, 20_000);
});
