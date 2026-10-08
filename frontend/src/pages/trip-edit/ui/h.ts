/**
 * Tiny DOM builder. Text always goes in as text nodes / textContent (never
 * innerHTML), so names, notes and links typed by users or returned by the
 * geocoder cannot become markup.
 */

export type Child = Node | string | number | null | false | undefined;

export interface Props {
  class?: string;
  /** Plain text content (set via textContent). */
  text?: string;
  /** Event listeners by name, e.g. { click: fn }. */
  on?: Record<string, EventListener>;
  /** Attributes (aria-*, data-*, role, ...). false / undefined are skipped, true sets "". */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  /** Properties assigned as-is: id, type, value, checked, disabled, hidden, href, title... */
  [prop: string]: unknown;
}

const RESERVED = new Set(['class', 'text', 'on', 'attrs']);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [k, v] of Object.entries(props)) {
    if (RESERVED.has(k) || v === undefined) continue;
    (el as unknown as Record<string, unknown>)[k] = v;
  }
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      if (v === false || v === undefined || v === null) continue;
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (props.on) for (const [type, fn] of Object.entries(props.on)) el.addEventListener(type, fn);
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === false || c === undefined) continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  el.replaceChildren();
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const PATHS: Record<string, string[]> = {
  grip: ['M9 5h.01', 'M9 12h.01', 'M9 19h.01', 'M15 5h.01', 'M15 12h.01', 'M15 19h.01'],
  up: ['M6 15l6-6 6 6'],
  down: ['M6 9l6 6 6-6'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
  back: ['M15 18l-6-6 6-6'],
  pin: ['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z', 'M12 7.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z'],
  maps: ['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z', 'M12 7.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z'],
  nav: ['M3 11l19-9-9 19-2-8-8-2z'],
  check: ['M20 6L9 17l-5-5'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M11 4a7 7 0 100 14 7 7 0 000-14z', 'M21 21l-4.3-4.3'],
  close: ['M18 6L6 18', 'M6 6l12 12'],
  cloud: ['M17.5 19a4.5 4.5 0 100-9h-1.3A6 6 0 104 14.5 4.5 4.5 0 006.5 19z'],
  copy: ['M9 9h11v11H9z', 'M5 15V4h11'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z'],
};

export function icon(name: keyof typeof PATHS | string, size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of PATHS[name] ?? []) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

let idCounter = 0;
/** Unique DOM id for label/aria wiring. */
export function uid(prefix = 'te'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Live-region announcement for screen readers (shared, polite). */
export function announce(message: string): void {
  let region = document.getElementById('te-announcer');
  if (!region) {
    region = document.createElement('div');
    region.id = 'te-announcer';
    region.className = 'sr-only';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  // Clear first so the same message twice is announced twice.
  region.textContent = '';
  window.setTimeout(() => { if (region) region.textContent = message; }, 30);
}
