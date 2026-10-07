// A11Y-04: WCAG 2.2 target-size (2.5.8). Markers that overlap on screen were flagged as
// "partially obscured" targets. The map now nudges overlapping markers apart in pixel space.
import { describe, it, expect, beforeEach } from 'vitest';
import * as L from 'leaflet';
import { spreadPoints, MARKER_SPACING, DeclutteredMarker, declutterMarkers } from '@/modules/declutter';

const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function minPairDistance(pts: { x: number; y: number }[]): number {
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) min = Math.min(min, chebyshev(pts[i], pts[j]));
  return min;
}

describe('spreadPoints', () => {
  it('leaves already separated points untouched', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
    expect(spreadPoints(pts)).toEqual(pts);
  });

  it('separates overlapping points so no two squares of MARKER_SPACING overlap', () => {
    const pts = [{ x: 100, y: 100 }, { x: 110, y: 104 }, { x: 95, y: 112 }, { x: 105, y: 99 }, { x: 118, y: 118 }];
    const out = spreadPoints(pts);
    expect(minPairDistance(out)).toBeGreaterThanOrEqual(MARKER_SPACING - 0.01);
  });

  it('separates identical coordinates (several activities at one place)', () => {
    const pts = Array.from({ length: 6 }, () => ({ x: 50, y: 50 }));
    const out = spreadPoints(pts);
    expect(minPairDistance(out)).toBeGreaterThanOrEqual(MARKER_SPACING - 0.01);
  });

  it('separates a dense Tokyo-like cluster (15 points in 80x80 px)', () => {
    const pts = Array.from({ length: 15 }, (_, i) => ({ x: 200 + ((i * 37) % 80), y: 200 + ((i * 53) % 80) }));
    const out = spreadPoints(pts);
    expect(minPairDistance(out)).toBeGreaterThanOrEqual(MARKER_SPACING - 0.01);
  });

  it('keeps displacement modest and does not mutate the input', () => {
    const pts = [{ x: 100, y: 100 }, { x: 108, y: 100 }];
    const copy = JSON.parse(JSON.stringify(pts));
    const out = spreadPoints(pts);
    expect(pts).toEqual(copy);
    // two points 8px apart need ~24px of extra separation, shared by both
    out.forEach((p, i) => expect(Math.hypot(p.x - pts[i].x, p.y - pts[i].y)).toBeLessThanOrEqual(MARKER_SPACING));
  });

  it('is deterministic', () => {
    const pts = [{ x: 1, y: 1 }, { x: 5, y: 2 }, { x: 3, y: 9 }];
    expect(spreadPoints(pts)).toEqual(spreadPoints(pts));
  });

  it('handles empty and single inputs', () => {
    expect(spreadPoints([])).toEqual([]);
    expect(spreadPoints([{ x: 3, y: 4 }])).toEqual([{ x: 3, y: 4 }]);
  });
});

describe('declutterMarkers on a Leaflet map', () => {
  let map: L.Map;
  beforeEach(() => {
    // jsdom lacks SVGRect, so Leaflet finds no vector renderer for the leader lines (same as overview-map.test)
    (L.Browser as { svg: boolean }).svg = true;
    document.body.innerHTML = '<div id="m" style="width:400px;height:400px"></div>';
    map = L.map('m', { center: [35.68, 139.76], zoom: 12 });
  });

  it('offsets only the markers that overlap and draws a leader line for each', () => {
    const near1 = new DeclutteredMarker([35.68, 139.76]).addTo(map);
    const near2 = new DeclutteredMarker([35.6801, 139.7601]).addTo(map);
    const far = new DeclutteredMarker([35.9, 139.2]).addTo(map);
    const lines = declutterMarkers(map, [near1, near2, far]);
    expect(near1.declutterOffset.distanceTo([0, 0])).toBeGreaterThan(0);
    expect(near2.declutterOffset.distanceTo([0, 0])).toBeGreaterThan(0);
    expect(far.declutterOffset.x).toBe(0);
    expect(far.declutterOffset.y).toBe(0);
    expect(lines.getLayers()).toHaveLength(2);
    // the true coordinates (popups, directions, route) are unchanged
    expect(near1.getLatLng().lat).toBeCloseTo(35.68, 6);
  });

  it('ignores markers that are not on the map (day filter) and clears stale offsets', () => {
    const a = new DeclutteredMarker([35.68, 139.76]).addTo(map);
    const b = new DeclutteredMarker([35.6801, 139.7601]).addTo(map);
    declutterMarkers(map, [a, b]);
    expect(a.declutterOffset.x !== 0 || a.declutterOffset.y !== 0).toBe(true);
    map.removeLayer(b);
    const lines = declutterMarkers(map, [a, b]);
    expect(a.declutterOffset.x).toBe(0);
    expect(a.declutterOffset.y).toBe(0);
    expect(lines.getLayers()).toHaveLength(0);
  });

  it('applies the offset to the rendered icon position', () => {
    const a = new DeclutteredMarker([35.68, 139.76]).addTo(map);
    const b = new DeclutteredMarker([35.68, 139.76]).addTo(map);
    declutterMarkers(map, [a, b]);
    const pos = (m: L.Marker) => { const st = (m.getElement() as HTMLElement).style; return `${st.transform}|${st.left}|${st.top}`; };
    const ta = pos(a);
    const tb = pos(b);
    expect(ta).not.toBe(tb);
  });
});
