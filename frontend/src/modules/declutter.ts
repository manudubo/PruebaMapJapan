import * as L from 'leaflet';

/**
 * Marker declutter (A11Y-04, WCAG 2.2 target-size 2.5.8).
 *
 * Numbered markers are 28x28 (hotel 32x32), but real itineraries put several stops a few
 * pixels apart, so the icons overlap and each is a "partially obscured" target. Instead of
 * clustering (which hides stops and breaks the numbered-order reading), overlapping markers
 * are nudged apart in screen space until their squares no longer overlap. Each displaced
 * marker keeps its true coordinates (popup, directions) and gets a thin leader line back to
 * the real spot. DOM order, tab order and keyboard focus are unchanged.
 */

/** Minimum centre-to-centre distance (Chebyshev, px): hotel marker is 32px, so squares never overlap. */
export const MARKER_SPACING = 34;

interface Pt {
  x: number;
  y: number;
}

/**
 * Pure relaxation: returns new positions where no two points are closer than `spacing`
 * (Chebyshev), moving each pair apart along the axis of least penetration. Deterministic,
 * does not mutate the input; points that are already apart do not move.
 */
export function spreadPoints(points: Pt[], spacing = MARKER_SPACING, maxIterations = 300): Pt[] {
  const out = points.map((p) => ({ x: p.x, y: p.y }));
  for (let iter = 0; iter < maxIterations; iter++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        let dx = out[j].x - out[i].x;
        let dy = out[j].y - out[i].y;
        if (Math.abs(dx) >= spacing || Math.abs(dy) >= spacing) continue;
        if (dx === 0 && dy === 0) {
          // identical spot: fan out on a deterministic angle per pair
          const a = ((i * 7 + j * 13) % 360) * (Math.PI / 180);
          dx = Math.cos(a) * 0.01;
          dy = Math.sin(a) * 0.01;
        }
        const ox = spacing - Math.abs(dx);
        const oy = spacing - Math.abs(dy);
        // 0.01 slack so float rounding never leaves a pair at spacing - epsilon
        if (ox <= oy) {
          const push = (ox + 0.01) / 2;
          const s = dx >= 0 ? 1 : -1;
          out[i].x -= s * push;
          out[j].x += s * push;
        } else {
          const push = (oy + 0.01) / 2;
          const s = dy >= 0 ? 1 : -1;
          out[i].y -= s * push;
          out[j].y += s * push;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

/** A marker whose icon can be shifted a few pixels on screen without changing its latlng. */
export class DeclutteredMarker extends L.Marker {
  declutterOffset: L.Point = L.point(0, 0);

  // Leaflet positions the icon (and shadow) here on add, move and zoom; adding the offset
  // keeps it correct through every re-layout.
  _setPos(pos: L.Point): void {
    (L.Marker.prototype as unknown as { _setPos(p: L.Point): void })._setPos.call(this, pos.add(this.declutterOffset));
  }
}

const leaderGroups = new WeakMap<L.Map, L.LayerGroup>();

/**
 * Spread the markers that are currently on the map; reset the ones that are not.
 * Returns the layer group holding the leader lines (re-created on every call).
 * Call after the markers are added, after the day filter changes and on `zoomend`.
 */
export function declutterMarkers(map: L.Map, markers: DeclutteredMarker[]): L.LayerGroup {
  let group = leaderGroups.get(map);
  if (!group) {
    group = L.layerGroup().addTo(map);
    leaderGroups.set(map, group);
  }
  group.clearLayers();

  const visible = markers.filter((m) => map.hasLayer(m));
  markers.forEach((m) => {
    if (!visible.includes(m)) m.declutterOffset = L.point(0, 0);
  });

  const real = visible.map((m) => map.latLngToLayerPoint(m.getLatLng()));
  const spread = spreadPoints(real);
  visible.forEach((m, i) => {
    m.declutterOffset = L.point(spread[i].x - real[i].x, spread[i].y - real[i].y);
    m.setLatLng(m.getLatLng()); // re-run layout so _setPos picks up the offset
    if (Math.abs(m.declutterOffset.x) > 0.5 || Math.abs(m.declutterOffset.y) > 0.5) {
      L.polyline([m.getLatLng(), map.layerPointToLatLng(L.point(spread[i].x, spread[i].y))], {
        weight: 1.5,
        color: '#6e6e73',
        opacity: 0.8,
        interactive: false,
        className: 'marker-leader',
      }).addTo(group!);
    }
  });
  return group;
}
