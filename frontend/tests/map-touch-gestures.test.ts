// Mobile: a full-width map must not capture one-finger swipes (it would block page scroll).
import { describe, it, expect, afterEach } from 'vitest';
import { createBaseMap } from '@/modules/baseMap';

function stubPointer(coarse: boolean): void {
  window.matchMedia = ((q: string) => ({
    matches: coarse && q.includes('coarse'),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function container(): HTMLElement {
  const el = document.createElement('div');
  el.style.height = '200px';
  document.body.appendChild(el);
  return el;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('map touch gestures', () => {
  it('touch screens: one-finger dragging is off and pinch stays on', () => {
    stubPointer(true);
    const { map } = createBaseMap(container(), [35, 135], 5);
    expect(map.dragging.enabled()).toBe(false);
    expect(map.touchZoom.enabled()).toBe(true);
  });

  it('touch screens: a one-finger move explains why the map did not move', () => {
    stubPointer(true);
    const el = container();
    const { map } = createBaseMap(el, [35, 135], 5);
    const ev = new Event('touchmove') as Event & { touches: unknown[] };
    ev.touches = [{}];
    map.getContainer().dispatchEvent(ev);
    expect(map.getContainer().querySelector('.map-gesture-hint')?.textContent).toBe('Use two fingers to move the map');
  });

  it('mouse screens: dragging is unchanged', () => {
    stubPointer(false);
    const { map } = createBaseMap(container(), [35, 135], 5);
    expect(map.dragging.enabled()).toBe(true);
  });

  it('a caller can still force dragging on', () => {
    stubPointer(true);
    const { map } = createBaseMap(container(), [35, 135], 5, { dragging: true });
    expect(map.dragging.enabled()).toBe(true);
  });
});
