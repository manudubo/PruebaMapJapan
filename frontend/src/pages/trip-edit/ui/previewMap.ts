/**
 * The live map of the editor: the demo's overview (numbered city squares and a
 * dashed route) and the demo's city map (day-coloured numbered places,
 * dashed-purple options, the hotel "H"), drawn from the editor's state.
 * Same marker classes and route style as map.ts / overviewMap.ts.
 */

import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { createBaseMap } from '@/modules/baseMap';
import { getThemeConfig } from '@/modules/theme';
import { setStyle } from '@/modules/dom';
import { h, icon } from './h';
import type { RouteStop } from '../model';
import { framePoints, type CityPreview, type LatLng, type PreviewGroup } from '../previewModel';

export interface MapHandlers {
  onSelectStop: (destKey: string) => void;
  onSelectItem: (itemKey: string) => void;
  onPick: (lat: number, lng: number) => void;
  onDragEnd: (itemKey: string, lat: number, lng: number) => void;
}

export type MapView =
  | { kind: 'route'; stops: RouteStop[]; selectedKey: string | null }
  | { kind: 'city'; city: CityPreview; groups: PreviewGroup[]; editable: boolean };

const WORLD: LatLng = [20, 10];

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function squareIcon(label: string, color: string, size: number, optional = false, className = ''): L.DivIcon {
  const div = document.createElement('div');
  div.className = `numbered-marker${optional ? ' optional' : ''}${className ? ` ${className}` : ''}`;
  setStyle(div, 'background', color);
  if (size !== 28) {
    setStyle(div, 'width', `${size}px`);
    setStyle(div, 'height', `${size}px`);
  }
  if (size > 28) setStyle(div, 'font-size', '13px');
  div.textContent = label;
  return L.divIcon({ className: 'custom-marker', html: div, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

function hotelIcon(): L.DivIcon {
  const div = document.createElement('div');
  div.className = 'hotel-marker';
  div.textContent = 'H';
  return L.divIcon({ className: 'custom-marker', html: div, iconSize: [32, 32], iconAnchor: [16, 16] });
}

function popupFor(item: { name: string; notes: string | null; time: string | null; mapsUrl: string | null; directionsUrl: string | null }, dayLabel: string, optionalLabel: string | null): HTMLElement {
  const links = item.mapsUrl || item.directionsUrl
    ? h('div', { class: 'popup-links' },
        item.mapsUrl ? h('a', { href: item.mapsUrl, target: '_blank', rel: 'noopener', class: 'popup-link' }, icon('maps', 14), h('span', { text: 'View on Maps' })) : null,
        item.directionsUrl ? h('a', { href: item.directionsUrl, target: '_blank', rel: 'noopener', class: 'popup-link directions' }, icon('nav', 14), h('span', { text: 'Directions' })) : null)
    : null;
  return h('div', {},
    h('div', { class: 'day-label' }, dayLabel, optionalLabel ? h('span', { class: 'optional-badge', text: `Option ${optionalLabel}` }) : null),
    h('h4', { text: item.name }),
    item.time ? h('p', { text: item.time }) : null,
    item.notes ? h('p', { text: item.notes }) : null,
    links,
  );
}

export class PreviewMap {
  readonly map: L.Map;
  private readonly layer = L.layerGroup();
  private route: L.Polyline | null = null;
  private markersByKey = new Map<string, L.Marker>();
  private fitToken = '';
  private picking = false;

  constructor(container: HTMLElement, private readonly handlers: MapHandlers) {
    const { map, tileLayer } = createBaseMap(container, WORLD, 2);
    this.map = map;
    window.currentMap = map;
    window.currentTileLayer = tileLayer;
    this.layer.addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (this.picking) this.handlers.onPick(e.latlng.lat, e.latlng.lng);
    });
    window.addEventListener('theme-changed', () => this.route?.setStyle({ color: getThemeConfig().routeColor }));
  }

  setPickMode(on: boolean): void {
    this.picking = on;
    this.map.getContainer().classList.toggle('is-picking', on);
  }

  isPicking(): boolean {
    return this.picking;
  }

  /** Re-measure after the pane became visible (mobile tab switch, resize). */
  invalidate(): void {
    this.map.invalidateSize();
  }

  highlight(key: string | null): void {
    for (const [k, m] of this.markersByKey) m.getElement()?.classList.toggle('is-highlighted', k === key);
  }

  openItem(key: string): void {
    const m = this.markersByKey.get(key);
    if (!m) return;
    this.map.panTo(m.getLatLng(), { animate: !reducedMotion() });
    m.openPopup();
  }

  /** Whether anything is drawn (drives the empty-map hint). */
  hasMarkers(): boolean {
    return this.markersByKey.size > 0;
  }

  render(view: MapView): void {
    this.layer.clearLayers();
    this.markersByKey.clear();
    this.route = null;
    let points: LatLng[] = [];
    let token = '';
    let zoomHint = 12;

    if (view.kind === 'route') {
      const located = view.stops.filter((s) => s.coords);
      for (const stop of located) {
        const marker = L.marker(stop.coords!, { icon: squareIcon(String(stop.number), stop.color, 32), alt: stop.label, title: stop.label, riseOnHover: true });
        marker.on('click', () => this.handlers.onSelectStop(stop.key));
        marker.addTo(this.layer);
        marker.getElement()?.setAttribute('aria-label', `${stop.number}. ${stop.label}${stop.dates ? `, ${stop.dates}` : ''} – open`);
        this.markersByKey.set(stop.key, marker);
      }
      if (located.length > 1) {
        this.route = L.polyline(located.map((s) => s.coords!), {
          color: getThemeConfig().routeColor, weight: 2, opacity: 0.5, dashArray: '8, 8', interactive: false,
        }).addTo(this.layer);
      }
      points = located.map((s) => s.coords!);
      token = `route:${located.length}`;
      this.highlight(view.selectedKey);
    } else {
      const { city, groups, editable } = view;
      for (const g of groups) {
        for (const item of g.items) {
          if (!item.coords) continue;
          const color = item.optional ? '#af52de' : g.color;
          const marker = L.marker(item.coords, {
            icon: squareIcon(item.label, color, 28, item.optional),
            alt: item.name, title: item.name, draggable: editable, riseOnHover: true,
          });
          marker.bindPopup(popupFor(item, g.label, item.optional ? item.label : null));
          marker.on('click', () => this.handlers.onSelectItem(item.key));
          marker.on('dragend', () => {
            const ll = marker.getLatLng();
            this.handlers.onDragEnd(item.key, ll.lat, ll.lng);
          });
          marker.addTo(this.layer);
          this.markersByKey.set(item.key, marker);
        }
      }
      if (city.hotel?.coords) {
        L.marker(city.hotel.coords, { icon: hotelIcon(), alt: city.hotel.name, title: city.hotel.name })
          .bindPopup(popupFor({ name: city.hotel.name, notes: 'Accommodation', time: null, mapsUrl: city.hotel.mapsUrl, directionsUrl: city.hotel.directionsUrl }, 'Hotel', null))
          .addTo(this.layer);
      }
      points = framePoints(city, groups);
      if (points.length === 0 && city.center) points = [city.center];
      zoomHint = city.zoom;
      token = `city:${city.key}:${groups.map((g) => g.key).join(',')}:${points.length}`;
    }

    if (token !== this.fitToken) {
      this.fitToken = token;
      this.frame(points, zoomHint);
    }
  }

  private frame(points: LatLng[], zoom: number): void {
    const animate = !reducedMotion();
    if (points.length === 0) {
      this.map.setView(WORLD, 2, { animate });
    } else if (points.length === 1) {
      this.map.setView(points[0]!, Math.min(zoom, 15), { animate });
    } else {
      this.map.fitBounds(L.latLngBounds(points).pad(0.25), { maxZoom: 15, animate });
    }
  }
}
