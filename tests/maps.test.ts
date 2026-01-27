import { describe, it, expect } from 'vitest';
import { getMapsUrl, hasMapsUrl } from '../src/data/maps';
import { createDirectionsUrl } from '../src/modules/utils';

describe('Maps Data Integration', () => {
  it('should return correct URL for known locations', () => {
    expect(getMapsUrl('Via Inn Prime Akasaka')).toBe('https://maps.app.goo.gl/FJ2AmEECHEvtAf1B9');
    expect(getMapsUrl('Ghibli Park')).toBe('https://maps.app.goo.gl/sY8BZo8bQPQtds199');
  });

  it('should return null for unknown locations', () => {
    expect(getMapsUrl('Lugar Inexistente')).toBeNull();
  });

  it('should verify existence of keys', () => {
    expect(hasMapsUrl('Palacio Imperial (Kōkyo)')).toBe(true);
    expect(hasMapsUrl('Nada')).toBe(false);
  });
});

describe('Directions URL Generation', () => {
  it('should generate valid Google Maps direction link', () => {
    const coords: [number, number] = [35.6762, 139.7050];
    const url = createDirectionsUrl(coords);
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=35.6762,139.705&travelmode=transit');
  });
});