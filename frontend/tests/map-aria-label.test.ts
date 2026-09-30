import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

// The Leaflet map container is keyboard-focusable; screen readers need a name for it.
// Only tokyo.html had one (24-E2E-SUMMARY.md, defect 5).

const ROOT = resolve(__dirname, '..');
const htmlPages = readdirSync(ROOT).filter((f) => f.endsWith('.html'));

function parse(file: string): Document {
  return new DOMParser().parseFromString(readFileSync(resolve(ROOT, file), 'utf8'), 'text/html');
}

const mapPages = htmlPages.filter((f) => parse(f).getElementById('map'));
const cityPages = mapPages.filter((f) => parse(f).getElementById('map')!.hasAttribute('data-city'));

describe('map container accessible name', () => {
  it('finds all 8 static city pages and the dynamic trip page', () => {
    expect(cityPages.sort()).toEqual(
      ['hakone', 'kyoto', 'nagoya', 'naoshima', 'osaka', 'takayama', 'tokyo', 'tokyo2'].map((c) => `${c}.html`),
    );
    expect(mapPages).toContain('trip.html');
  });

  it.each(mapPages)('%s gives #map a role and a non-empty aria-label', (file) => {
    const map = parse(file).getElementById('map')!;
    expect(map.getAttribute('role')).toBe('application');
    expect(map.getAttribute('aria-label')?.trim()).toMatch(/^Map\b/);
  });

  it.each(cityPages)('%s labels the map with its own city (matches the h1)', (file) => {
    const doc = parse(file);
    const city = doc.querySelector('h1')!.textContent!.trim();
    expect(doc.getElementById('map')!.getAttribute('aria-label')).toBe(`Map of ${city}`);
  });

  it('city map labels are unique across pages', () => {
    const labels = cityPages.map((f) => parse(f).getElementById('map')!.getAttribute('aria-label'));
    expect(new Set(labels).size).toBe(labels.length);
  });
});
