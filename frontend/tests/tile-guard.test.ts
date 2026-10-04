import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { classifyTile, decodePng, PLACEHOLDER_DISTANCE, thumbnail, thumbnailDistance } from '../build/tileGuard';

// Offline half of the tile guard: the classifier used by scripts/check-live-tiles.ts
// must reject the real placeholder images providers serve with HTTP 200, and accept
// real map tiles. Fixtures are the actual bytes downloaded on 2026-10-04.

const fixture = (name: string): Uint8Array => readFileSync(resolve(__dirname, 'fixtures/tiles', name));

const PLACEHOLDERS = ['carto-apikey-light.png', 'carto-apikey-dark.png', 'osm-blocked-403.png'];
const REAL = ['osm-real-6-56-25.png', 'osm-real-12-3592-1622.png'];
const known = PLACEHOLDERS.map(fixture);

// 1x1 transparent PNG (the e2e blank tile stub)
const BLANK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('tile guard classifier', () => {
  it('decodes 4-bit and 8-bit palette tiles to 256x256 RGBA', () => {
    for (const f of ['carto-apikey-light.png', 'osm-real-6-56-25.png']) {
      const img = decodePng(fixture(f));
      expect([img.width, img.height, img.rgba.length]).toEqual([256, 256, 256 * 256 * 4]);
    }
  });

  it.each(PLACEHOLDERS)('rejects the known placeholder %s', (name) => {
    const verdict = classifyTile(fixture(name), known);
    expect(verdict.ok).toBe(false);
  });

  it('rejects a re-rendered placeholder that is not byte-identical (OSM 418 vs 403 image)', () => {
    const verdict = classifyTile(fixture('osm-blocked-418.png'), known);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/looks like known placeholder/);
  });

  it('rejects the Carto placeholder even without the fixture list (flat colour heuristic)', () => {
    expect(classifyTile(fixture('carto-apikey-light.png'), []).ok).toBe(false);
    expect(classifyTile(BLANK, []).ok).toBe(false);
  });

  it('rejects responses that are not PNG (HTML error page, empty body)', () => {
    expect(classifyTile(Buffer.from('<html>403 Forbidden</html>'), known).ok).toBe(false);
    expect(classifyTile(new Uint8Array(0), known).ok).toBe(false);
  });

  it.each(REAL)('accepts the real map tile %s', (name) => {
    const verdict = classifyTile(fixture(name), known);
    expect(verdict).toMatchObject({ ok: true });
  });

  it('keeps a wide margin between real tiles and placeholders', () => {
    for (const r of REAL) {
      for (const p of PLACEHOLDERS) {
        const d = thumbnailDistance(thumbnail(decodePng(fixture(r))), thumbnail(decodePng(fixture(p))));
        expect(d).toBeGreaterThan(PLACEHOLDER_DISTANCE * 3);
      }
    }
  });
});
