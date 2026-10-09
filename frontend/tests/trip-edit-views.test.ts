import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EditorStore, type EditorApi } from '@/pages/trip-edit/store';
import { SaveQueue } from '@/pages/trip-edit/saveQueue';
import { PlaceSearch } from '@/pages/trip-edit/placeSearch';
import { mountCityView } from '@/pages/trip-edit/views/cityView';
import { mountRouteView } from '@/pages/trip-edit/views/routeView';
import { mountShareView } from '@/pages/trip-edit/views/shareView';
import { describeBanner, describeStatus } from '@/pages/trip-edit/status';
import type { ViewCtx } from '@/pages/trip-edit/views/types';
import type { ApiTrip } from '@/types';

const trip = (): ApiTrip => ({
  id: '1', user_id: '1', name: 'T', description: null, start_date: '2026-02-22', end_date: '2026-02-24',
  cover_image_url: null, is_public: false, public_slug: null,
  destinations: [{ id: '5', trip_id: '1', city_name: 'Kyoto', country: 'Japan', start_date: '2026-02-22', end_date: '2026-02-24', lat: 35, lng: 135, zoom_level: 12, order_index: 0, days: [] }],
});

function setup() {
  let n = 100;
  const api = new Proxy({}, { get: () => vi.fn(async () => ({ id: n++ })) }) as unknown as EditorApi;
  const store = new EditorStore(trip(), api, new SaveQueue({ retryDelaysMs: [] }), { debounceMs: 10 });
  const go = vi.fn();
  const ctx: ViewCtx = {
    store, go,
    createSearch: () => new PlaceSearch({ search: async () => [], mode: 'direct' }),
    pickOnMap: vi.fn(), isPicking: () => false, focusOnMap: vi.fn(), isNew: false,
    createTrip: vi.fn(async () => {}),
    tripPageUrl: (id) => `https://x/trip.html?tripId=${id}`,
    publicPageUrl: (s) => `https://x/trip.html?slug=${s}`,
    copyText: vi.fn(async () => true),
    highlight: vi.fn(),
  };
  return { store, ctx, go };
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { vi.restoreAllMocks(); });

describe('city view', () => {
  it('shows a chip per date, adds places to the selected day, renders hostile names as text', () => {
    const { store, ctx } = setup();
    const dest = store.trip.destinations[0]!;
    const view = mountCityView(ctx, dest._key, null);
    document.body.append(view.el);
    expect(document.querySelectorAll('#day-chips .day-btn')).toHaveLength(3);
    expect(document.getElementById('activities-empty')!.hidden).toBe(false);

    const evil = '<img src=x onerror=alert(1)>';
    store.addActivity(dest._key, '2026-02-22', { name: evil, lat: 35, lng: 135 });
    view.update({ kind: 'structure' });
    const rows = document.querySelectorAll('#activity-list > li');
    expect(rows).toHaveLength(1);
    expect((rows[0]!.querySelector('[data-role="name"]') as HTMLInputElement).value).toBe(evil);
    expect(document.querySelector('#activity-list img')).toBeNull();
    expect(document.querySelector('#day-chips .day-btn.active .te-day-count')!.textContent).toBe('1');
  });

  it('refuses an empty name inline and does not save it', () => {
    const { store, ctx } = setup();
    const dest = store.trip.destinations[0]!;
    const act = store.addActivity(dest._key, '2026-02-22', { name: 'A' })!;
    const view = mountCityView(ctx, dest._key, '2026-02-22');
    document.body.append(view.el);
    const name = document.querySelector('[data-role="name"]') as HTMLInputElement;
    name.value = '  ';
    name.dispatchEvent(new Event('input'));
    expect(document.querySelector('[data-role="name-error"]')!.textContent).toMatch(/Name this place/);
    expect(act.name).toBe('A');
    name.dispatchEvent(new Event('blur'));
    expect(name.value).toBe('A');
  });

  it('a city without dates asks for them and hides the composer', () => {
    const { store, ctx } = setup();
    store.patchDestination(store.trip.destinations[0]!._key, { start_date: null, end_date: null }, true);
    const view = mountCityView(ctx, store.trip.destinations[0]!._key, null);
    document.body.append(view.el);
    expect(document.getElementById('no-dates')!.hidden).toBe(false);
    expect(document.getElementById('day-panel')!.hidden).toBe(true);
  });

  it('a missing destination offers the way back', () => {
    const { ctx, go } = setup();
    const view = mountCityView(ctx, 'nope', null);
    document.body.append(view.el);
    (view.el.querySelector('button') as HTMLButtonElement).click();
    expect(go).toHaveBeenCalledWith({ step: 'route' });
  });
});

describe('route view', () => {
  it('lists destinations numbered, disables the end arrows and deletes with undo available', () => {
    const { store, ctx } = setup();
    const view = mountRouteView(ctx);
    document.body.append(view.el);
    expect(document.querySelectorAll('#destinations-list > li')).toHaveLength(1);
    expect(document.querySelector('.te-num')!.textContent).toBe('1');
    expect((document.querySelector('[data-role="up"]') as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector('[data-role="down"]') as HTMLButtonElement).disabled).toBe(true);
    const undo = vi.fn();
    store.onUndo(undo);
    (document.querySelector('[data-role="delete"]') as HTMLButtonElement).click();
    view.update({ kind: 'structure' });
    expect(document.getElementById('destinations-empty')!.hidden).toBe(false);
    expect(undo).toHaveBeenCalledWith({ label: 'Kyoto' });
    store.undoDelete();
    view.update({ kind: 'structure' });
    expect(document.querySelectorAll('#destinations-list > li')).toHaveLength(1);
  });
});

describe('share view', () => {
  it('toggling public saves at once and shows the link once the slug exists', () => {
    const { store, ctx } = setup();
    const view = mountShareView(ctx);
    document.body.append(view.el);
    expect(document.getElementById('public-link')!.closest('.te-link-row')!.hasAttribute('hidden')).toBe(true);
    const box = document.getElementById('trip-public') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(store.trip.is_public).toBe(true);
    store.trip.public_slug = 'abc';
    view.update({ kind: 'trip' });
    expect((document.getElementById('public-link') as HTMLInputElement).value).toBe('https://x/trip.html?slug=abc');
  });

  it('the checklist says what is missing', () => {
    const { ctx } = setup();
    const view = mountShareView(ctx);
    document.body.append(view.el);
    expect(document.getElementById('share-checklist')!.textContent).toContain('Add a place to visit');
  });
});

describe('status wording', () => {
  const snap = (over = {}) => ({ status: 'idle' as const, pending: 0, lastSavedAt: null, error: null, issues: [], ...over });
  it('describes every state', () => {
    expect(describeStatus(snap()).state).toBe('idle');
    expect(describeStatus(snap({ lastSavedAt: 1 })).text).toBe('Saved');
    expect(describeStatus(snap({ lastSavedAt: 1 }), true).state).toBe('saving');
    expect(describeStatus(snap({ status: 'saving' })).state).toBe('saving');
    expect(describeStatus(snap({ status: 'offline' })).state).toBe('offline');
    expect(describeStatus(snap({ status: 'error', error: { kind: 'transient', message: 'x', willRetry: true } })).state).toBe('error');
  });
  it('banners: error (no retry on auth), offline, issues, none', () => {
    expect(describeBanner(snap())).toBeNull();
    expect(describeBanner(snap({ status: 'error', error: { kind: 'transient', message: 'down.', willRetry: true } }))).toMatchObject({ kind: 'error', retry: true, detail: 'down. Trying again…' });
    expect(describeBanner(snap({ status: 'error', error: { kind: 'auth', message: 'expired', willRetry: false } }))!.retry).toBe(false);
    expect(describeBanner(snap({ status: 'error', error: { kind: 'verify', message: 'v', willRetry: false } }))!.title).toMatch(/Verify/);
    expect(describeBanner(snap({ status: 'offline' }))!.kind).toBe('offline');
    expect(describeBanner(snap({ issues: [{ label: 'Add X', message: 'no' }, { label: 'b', message: 'c' }] }))).toMatchObject({ kind: 'issues', reload: true, detail: expect.stringContaining('and 1 more') });
  });
});
