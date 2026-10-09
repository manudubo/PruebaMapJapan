import { describe, it, expect, vi } from 'vitest';
import { placeNameFromMapsUrl } from '@/pages/trip-edit/model';
import { parseHash, formatHash, initialNav, sameNav } from '@/pages/trip-edit/nav';
import { dropIndex, makeSortable } from '@/pages/trip-edit/ui/sortable';
import { reconcile } from '@/pages/trip-edit/ui/reconcile';
import { h } from '@/pages/trip-edit/ui/h';

describe('placeNameFromMapsUrl', () => {
  it('reads the place segment', () => {
    expect(placeNameFromMapsUrl('https://www.google.com/maps/place/Kinkaku-ji/@35.03,135.72,17z')).toBe('Kinkaku-ji');
    expect(placeNameFromMapsUrl('https://www.google.com/maps/place/Fushimi+Inari+Taisha/@34.9,135.7')).toBe('Fushimi Inari Taisha');
    expect(placeNameFromMapsUrl('https://www.google.com/maps/place/Caf%C3%A9+Kyoto/data=!3d1')).toBe('Café Kyoto');
  });
  it('falls back when there is none or it is malformed', () => {
    expect(placeNameFromMapsUrl('https://www.google.com/maps/@35.03,135.72,17z')).toBe('Pinned place');
    expect(placeNameFromMapsUrl('https://www.google.com/maps/place/%E0%A4%A/@1,2')).toBe('Pinned place');
  });
});

describe('nav hash', () => {
  it('round-trips every state', () => {
    for (const n of [
      { step: 'trip' }, { step: 'route' }, { step: 'share' },
      { step: 'city', destId: '12', date: null }, { step: 'city', destId: '12', date: '2026-02-22' },
    ] as const) {
      expect(parseHash(formatHash(n))).toEqual(n);
    }
  });
  it('rejects junk', () => {
    for (const bad of ['', '#', '#nope', '#city/', '#city/<script>', '#city/1/2026-2-2', '#city/1/2026-02-22/extra', `#city/${'x'.repeat(60)}`]) {
      expect(parseHash(bad)).toBeNull();
    }
  });
  it('starts on the trip step when new, else the hash, else the route', () => {
    expect(initialNav('#share', true)).toEqual({ step: 'trip' });
    expect(initialNav('#share', false)).toEqual({ step: 'share' });
    expect(initialNav('', false)).toEqual({ step: 'route' });
    expect(sameNav({ step: 'route' }, { step: 'route' })).toBe(true);
  });
});

describe('dropIndex', () => {
  const mids = [10, 30, 50, 70];
  it('computes the landing index ignoring the dragged row', () => {
    expect(dropIndex(mids, 0, 2)).toBe(0);
    expect(dropIndex(mids, 100, 0)).toBe(3);
    expect(dropIndex(mids, 40, 0)).toBe(1);
    expect(dropIndex(mids, 41, 3)).toBe(2);
    expect(dropIndex(mids, 50, 2)).toBe(2);
  });
  it('a single row stays put', () => {
    expect(dropIndex([10], 999, 0)).toBe(0);
  });
});

function list(n: number): HTMLElement {
  const ul = h('ul');
  for (let i = 0; i < n; i++) {
    const li = h('li', { class: 'row' }, h('button', { class: 'grip', type: 'button', text: `grip${i}` }));
    li.dataset['key'] = `k${i}`;
    ul.appendChild(li);
  }
  document.body.appendChild(ul);
  return ul;
}

describe('makeSortable (keyboard)', () => {
  it('ArrowUp / ArrowDown / Home / End on a handle report the move', () => {
    const ul = list(4);
    const onMove = vi.fn();
    makeSortable(ul, { handle: '.grip', onMove });
    const grip = (i: number) => ul.children[i]!.querySelector('.grip')!;
    grip(1).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    grip(1).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    grip(2).dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    grip(0).dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(onMove.mock.calls).toEqual([[1, 0], [1, 2], [2, 0], [0, 3]]);
  });
  it('does not move past the ends and ignores other keys', () => {
    const ul = list(2);
    const onMove = vi.fn();
    makeSortable(ul, { handle: '.grip', onMove });
    ul.children[0]!.querySelector('.grip')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    ul.children[1]!.querySelector('.grip')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    ul.children[1]!.querySelector('.grip')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(onMove).not.toHaveBeenCalled();
  });
  it('dispose stops listening', () => {
    const ul = list(3);
    const onMove = vi.fn();
    const off = makeSortable(ul, { handle: '.grip', onMove });
    off();
    ul.children[1]!.querySelector('.grip')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('reconcile', () => {
  const mk = (k: string): HTMLElement => h('li', { text: k });
  const keys = (ul: HTMLElement): string[] => Array.from(ul.children).map((c) => (c as HTMLElement).dataset['key']!);

  it('creates, keeps node identity, reorders and removes', () => {
    const ul = h('ul');
    reconcile(ul, ['a', 'b', 'c'], (k) => k, mk);
    const [a, b, c] = Array.from(ul.children);
    reconcile(ul, ['c', 'a', 'd'], (k) => k, mk);
    expect(keys(ul)).toEqual(['c', 'a', 'd']);
    expect(ul.children[0]).toBe(c);
    expect(ul.children[1]).toBe(a);
    expect(b!.isConnected).toBe(false);
  });
  it('calls update for survivors only', () => {
    const ul = h('ul');
    const update = vi.fn();
    reconcile(ul, ['a'], (k) => k, mk, update);
    expect(update).not.toHaveBeenCalled();
    reconcile(ul, ['a', 'b'], (k) => k, mk, update);
    expect(update).toHaveBeenCalledTimes(1);
  });
  it('handles empty -> many -> empty', () => {
    const ul = h('ul');
    reconcile(ul, Array.from({ length: 200 }, (_, i) => `k${i}`), (k) => k, mk);
    expect(ul.children).toHaveLength(200);
    reconcile(ul, [], (k: string) => k, mk);
    expect(ul.children).toHaveLength(0);
  });
});

describe('h()', () => {
  it('sets text as text, never markup', () => {
    const el = h('div', { text: '<img src=x onerror=alert(1)>' }, h('span', {}, '<b>x</b>'));
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });
  it('applies props, attrs and listeners', () => {
    const fn = vi.fn();
    const el = h('button', { class: 'x', type: 'button', disabled: true, attrs: { 'aria-label': 'L', 'data-x': 1, skip: false }, on: { click: fn } });
    el.disabled = false;
    el.click();
    expect(el.className).toBe('x');
    expect(el.getAttribute('aria-label')).toBe('L');
    expect(el.getAttribute('data-x')).toBe('1');
    expect(el.hasAttribute('skip')).toBe(false);
    expect(fn).toHaveBeenCalled();
  });
});
