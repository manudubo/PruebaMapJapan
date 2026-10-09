import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EditorStore, type EditorApi } from '@/pages/trip-edit/store';
import { SaveQueue } from '@/pages/trip-edit/saveQueue';
import { isTempId, type Place } from '@/pages/trip-edit/model';
import type { ApiTrip } from '@/types';

const trip = (over: Partial<ApiTrip> = {}): ApiTrip => ({
  id: '1', user_id: '1', name: 'Japan', description: null, start_date: '2026-02-22', end_date: '2026-03-24',
  cover_image_url: null, is_public: false, public_slug: null, destinations: [], ...over,
});
const kyoto: Place = { name: 'Kyoto', country: 'Japan', lat: 35.01, lng: 135.76, label: 'Kyoto, Japan' };
const tokyo: Place = { name: 'Tokyo', country: 'Japan', lat: 35.68, lng: 139.69, label: 'Tokyo, Japan' };

let nextId = 100;
function makeApi() {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const rec = <T>(fn: string, result: (args: unknown[]) => T) => vi.fn(async (...args: unknown[]) => { calls.push({ fn, args }); return result(args); });
  const api = {
    updateTrip: rec('updateTrip', (a) => ({ id: 1, ...(a[1] as object), public_slug: (a[1] as { is_public?: boolean }).is_public ? 'slug-1' : null })),
    createDestination: rec('createDestination', (a) => ({ id: nextId++, days: [], ...(a[1] as object) })),
    updateDestination: rec('updateDestination', () => ({})),
    deleteDestination: rec('deleteDestination', () => undefined),
    createDay: rec('createDay', (a) => ({ id: nextId++, activities: [], ...(a[2] as object) })),
    updateDay: rec('updateDay', () => ({})),
    deleteDay: rec('deleteDay', () => undefined),
    upsertHotel: rec('upsertHotel', () => ({ id: nextId++ })),
    deleteHotel: rec('deleteHotel', () => undefined),
    createActivity: rec('createActivity', (a) => ({ id: nextId++, ...(a[3] as object) })),
    updateActivity: rec('updateActivity', () => ({})),
    deleteActivity: rec('deleteActivity', () => undefined),
    reorderActivities: rec('reorderActivities', () => []),
  };
  return { api: api as unknown as EditorApi & typeof api, calls };
}

function setup(t: ApiTrip = trip()) {
  const { api, calls } = makeApi();
  const queue = new SaveQueue({ retryDelaysMs: [] });
  const store = new EditorStore(t, api, queue, { debounceMs: 100, undoMs: 1000 });
  return { store, api, calls, queue };
}
const names = (calls: Array<{ fn: string }>) => calls.map((c) => c.fn);

beforeEach(() => { vi.useFakeTimers(); nextId = 100; });
afterEach(() => { vi.useRealTimers(); });

describe('destinations', () => {
  it('addDestination shows the row at once with a temp id, then the server id', async () => {
    const { store, calls, queue } = setup();
    const d = store.addDestination(kyoto);
    expect(isTempId(d.id)).toBe(true);
    expect(store.trip.destinations).toHaveLength(1);
    expect(d).toMatchObject({ city_name: 'Kyoto', country: 'Japan', order_index: 0, zoom_level: 12, start_date: '2026-02-22', end_date: '2026-02-24' });
    await queue.idle();
    expect(d.id).toBe('100');
    expect(calls[0]).toMatchObject({ fn: 'createDestination', args: ['1', expect.objectContaining({ city_name: 'Kyoto', lat: 35.01, lng: 135.76, order_index: 0 })] });
  });

  it('sends increasing order_index (the API defaults to 0) and chains dates', async () => {
    const { store, calls, queue } = setup();
    store.addDestination(kyoto);
    store.addDestination(tokyo);
    await queue.idle();
    const bodies = calls.filter((c) => c.fn === 'createDestination').map((c) => c.args[1] as { order_index: number; start_date: string });
    expect(bodies.map((b) => b.order_index)).toEqual([0, 1]);
    expect(bodies[1]!.start_date).toBe('2026-02-24');
  });

  it('a place without a country borrows the trip\'s most used one', () => {
    const { store } = setup();
    store.addDestination(kyoto);
    expect(store.addDestination({ ...tokyo, country: '' }).country).toBe('Japan');
    expect(setup().store.addDestination({ ...tokyo, country: '' }).country).toBe('—');
  });

  it('rolls back an add the server refuses for good', async () => {
    const { store, api, queue } = setup();
    api.createDestination.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 422 }));
    store.addDestination(kyoto);
    await queue.idle();
    expect(store.trip.destinations).toHaveLength(0);
    expect(queue.snapshot().issues).toHaveLength(1);
  });

  it('edits are debounced and coalesced into one PATCH with the latest values', async () => {
    const { store, calls, queue } = setup();
    const d = store.addDestination(kyoto);
    await queue.idle();
    store.patchDestination(d._key, { city_name: 'K' });
    await vi.advanceTimersByTimeAsync(50);
    store.patchDestination(d._key, { city_name: 'Ky' });
    store.patchDestination(d._key, { country: 'Nippon' });
    await vi.advanceTimersByTimeAsync(50);
    expect(calls.filter((c) => c.fn === 'updateDestination')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    await queue.idle();
    const patches = calls.filter((c) => c.fn === 'updateDestination');
    expect(patches).toHaveLength(1);
    expect(patches[0]!.args).toEqual(['1', '100', { city_name: 'Ky', country: 'Nippon' }]);
  });

  it('an edit made while the create is still queued lands on the real id', async () => {
    const { store, calls, queue } = setup();
    const d = store.addDestination(kyoto);
    store.patchDestination(d._key, { city_name: 'Kyōto' }, true);
    await queue.idle();
    expect(names(calls)).toEqual(['createDestination', 'updateDestination']);
    expect(calls[1]!.args[1]).toBe('100');
  });

  it('flush() sends debounced edits immediately', async () => {
    const { store, calls, queue } = setup();
    const d = store.addDestination(kyoto);
    await queue.idle();
    store.patchDestination(d._key, { zoom_level: 14 });
    expect(store.hasUnsynced()).toBe(true);
    store.flush();
    await queue.idle();
    expect(calls.at(-1)).toMatchObject({ fn: 'updateDestination', args: ['1', '100', { zoom_level: 14 }] });
    expect(store.hasUnsynced()).toBe(false);
  });

  it('moveDestination renumbers and saves only the rows whose order changed', async () => {
    const { store, calls, queue } = setup();
    const a = store.addDestination(kyoto);
    const b = store.addDestination(tokyo);
    const c = store.addDestination({ ...kyoto, name: 'Osaka' });
    await queue.idle();
    calls.length = 0;
    store.moveDestination(c._key, 0);
    await queue.idle();
    expect(store.trip.destinations.map((d) => d.city_name)).toEqual(['Osaka', 'Kyoto', 'Tokyo']);
    expect(store.trip.destinations.map((d) => d.order_index)).toEqual([0, 1, 2]);
    expect(calls.map((x) => [x.args[1], (x.args[2] as { order_index: number }).order_index]).sort()).toEqual([
      [a.id, 1], [b.id, 2], [c.id, 0],
    ].sort());
  });

  it('moving to the same place or an unknown row does nothing', async () => {
    const { store, calls, queue } = setup();
    const a = store.addDestination(kyoto);
    await queue.idle();
    calls.length = 0;
    store.moveDestination(a._key, 0);
    store.moveDestination('nope', 0);
    await queue.idle();
    expect(calls).toEqual([]);
  });
});

describe('delete + undo', () => {
  it('removes at once, sends the DELETE only after the undo window', async () => {
    const { store, calls, queue } = setup();
    const d = store.addDestination(kyoto);
    await queue.idle();
    calls.length = 0;
    store.removeDestination(d._key);
    expect(store.trip.destinations).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(900);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    await queue.idle();
    expect(calls).toEqual([{ fn: 'deleteDestination', args: ['1', '100'] }]);
  });

  it('undo restores the row at its old position and nothing is sent', async () => {
    const { store, calls, queue } = setup();
    store.addDestination(kyoto);
    const b = store.addDestination(tokyo);
    store.addDestination({ ...kyoto, name: 'Osaka' });
    await queue.idle();
    calls.length = 0;
    store.removeDestination(b._key);
    expect(store.trip.destinations.map((d) => d.city_name)).toEqual(['Kyoto', 'Osaka']);
    expect(store.undoDelete()).toBe(true);
    expect(store.trip.destinations.map((d) => d.city_name)).toEqual(['Kyoto', 'Tokyo', 'Osaka']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual([]);
    expect(store.undoDelete()).toBe(false);
  });

  it('a second delete makes the first final', async () => {
    const { store, calls, queue } = setup();
    const a = store.addDestination(kyoto);
    const b = store.addDestination(tokyo);
    await queue.idle();
    calls.length = 0;
    store.removeDestination(a._key);
    store.removeDestination(b._key);
    await queue.idle();
    expect(calls).toEqual([{ fn: 'deleteDestination', args: ['1', '100'] }]);
    expect(store.undoDelete()).toBe(true); // undoes b only
    expect(store.trip.destinations.map((d) => d.city_name)).toEqual(['Tokyo']);
  });

  it('notifies undo listeners with the label, then null', () => {
    const { store } = setup();
    const d = store.addDestination(kyoto);
    const seen: Array<string | null> = [];
    store.onUndo((u) => seen.push(u?.label ?? null));
    store.removeDestination(d._key);
    store.undoDelete();
    expect(seen).toEqual(['Kyoto', null]);
  });

  it('flush() commits a pending delete (page hide)', async () => {
    const { store, calls, queue } = setup();
    const d = store.addDestination(kyoto);
    await queue.idle();
    calls.length = 0;
    store.removeDestination(d._key);
    store.flush();
    await queue.idle();
    expect(names(calls)).toEqual(['deleteDestination']);
  });

  it('deleting a row whose create never succeeded sends nothing', async () => {
    const { store, api, calls, queue } = setup();
    api.createDestination.mockRejectedValue(Object.assign(new Error('x'), { status: 422 }));
    const d = store.addDestination(kyoto);
    await queue.idle();
    calls.length = 0;
    store.removeDestination(d._key); // already rolled back: no-op
    store.flush();
    await queue.idle();
    expect(calls).toEqual([]);
  });
});

describe('days and activities', () => {
  async function withDest() {
    const s = setup();
    const d = s.store.addDestination(kyoto);
    await s.queue.idle();
    s.calls.length = 0;
    return { ...s, d };
  }

  it('adding a place to a date with no day row creates the day first, then the activity, in order', async () => {
    const { store, calls, queue, d } = await withDest();
    const act = store.addActivity(d._key, '2026-02-23', { name: 'Fushimi Inari', lat: 34.97, lng: 135.77 });
    expect(act).not.toBeNull();
    expect(d.days).toHaveLength(1);
    expect(d.days[0]!.activities).toHaveLength(1);
    await queue.idle();
    expect(names(calls)).toEqual(['createDay', 'createActivity']);
    expect(calls[0]!.args).toEqual(['1', '100', expect.objectContaining({ date: '2026-02-23', order_index: 0, color_hex: expect.stringMatching(/^#[0-9a-f]{6}$/) })]);
    expect(calls[1]!.args.slice(0, 3)).toEqual(['1', '100', d.days[0]!.id]);
    expect(isTempId(act!.id)).toBe(false);
  });

  it('a second place on the same date reuses the day', async () => {
    const { store, calls, queue, d } = await withDest();
    store.addActivity(d._key, '2026-02-23', { name: 'A' });
    store.addActivity(d._key, '2026-02-23', { name: 'B' });
    await queue.idle();
    expect(names(calls)).toEqual(['createDay', 'createActivity', 'createActivity']);
    expect(calls.filter((c) => c.fn === 'createActivity').map((c) => (c.args[3] as { order_index: number }).order_index)).toEqual([0, 1]);
  });

  it('200 activities in a day', async () => {
    const { store, calls, queue, d } = await withDest();
    for (let i = 0; i < 200; i++) store.addActivity(d._key, '2026-02-23', { name: `Place ${i}` });
    await queue.idle();
    expect(calls.filter((c) => c.fn === 'createActivity')).toHaveLength(200);
    expect(d.days[0]!.activities.every((a) => !isTempId(a.id))).toBe(true);
    expect(new Set(d.days[0]!.activities.map((a) => a.id)).size).toBe(200);
  });

  it('activity edits go out as one PATCH of the changed fields', async () => {
    const { store, calls, queue, d } = await withDest();
    const act = store.addActivity(d._key, '2026-02-23', { name: 'A' })!;
    await queue.idle();
    calls.length = 0;
    store.patchActivity(act._key, { time: '09:30' });
    store.patchActivity(act._key, { notes: 'Go early', is_optional: true });
    await vi.advanceTimersByTimeAsync(200);
    await queue.idle();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe('updateActivity');
    expect(calls[0]!.args[4]).toEqual({ time: '09:30', notes: 'Go early', is_optional: true });
  });

  it('clearing a field sends null, not undefined', async () => {
    const { store, calls, queue, d } = await withDest();
    const act = store.addActivity(d._key, '2026-02-23', { name: 'A', notes: 'n' })!;
    await queue.idle();
    calls.length = 0;
    store.patchActivity(act._key, { notes: null }, true);
    await queue.idle();
    expect(calls[0]!.args[4]).toEqual({ notes: null });
  });

  it('rapid reorders collapse into one call carrying the final order', async () => {
    const { store, calls, queue, d } = await withDest();
    const [a, b, c] = ['A', 'B', 'C'].map((n) => store.addActivity(d._key, '2026-02-23', { name: n })!);
    await queue.idle();
    calls.length = 0;
    store.addActivity(d._key, '2026-02-23', { name: 'D' }); // keeps the queue busy, so the moves below pile up behind it
    store.moveActivity(a!._key, 2);
    store.moveActivity(b!._key, 2);
    store.moveActivity(c!._key, 0);
    const order = d.days[0]!.activities.map((x) => x.name);
    await queue.idle();
    expect(calls.filter((x) => x.fn === 'reorderActivities')).toHaveLength(1);
    expect(calls.find((x) => x.fn === 'reorderActivities')!.args[3]).toEqual(d.days[0]!.activities.map((x) => Number(x.id)));
    expect(d.days[0]!.activities.map((x) => x.name)).toEqual(order);
    expect(d.days[0]!.activities.map((x) => x.order_index)).toEqual([0, 1, 2, 3]);
  });

  it('reordering while activities are still being created waits for their ids', async () => {
    const { store, calls, queue, d } = await withDest();
    const a = store.addActivity(d._key, '2026-02-23', { name: 'A' })!;
    store.addActivity(d._key, '2026-02-23', { name: 'B' });
    store.moveActivity(a._key, 1);
    await queue.idle();
    const reorder = calls.find((c) => c.fn === 'reorderActivities')!;
    expect(reorder.args[3]).toEqual(d.days[0]!.activities.map((x) => Number(x.id)));
    expect((reorder.args[3] as number[]).every((n) => Number.isFinite(n))).toBe(true);
  });

  it('delete + undo of an activity', async () => {
    const { store, calls, queue, d } = await withDest();
    const act = store.addActivity(d._key, '2026-02-23', { name: 'A' })!;
    store.addActivity(d._key, '2026-02-23', { name: 'B' });
    await queue.idle();
    calls.length = 0;
    store.removeActivity(act._key);
    expect(d.days[0]!.activities.map((x) => x.name)).toEqual(['B']);
    store.undoDelete();
    expect(d.days[0]!.activities.map((x) => x.name)).toEqual(['A', 'B']);
    store.removeActivity(act._key);
    await vi.advanceTimersByTimeAsync(1500);
    await queue.idle();
    expect(calls).toEqual([{ fn: 'deleteActivity', args: ['1', '100', d.days[0]!.id, act.id] }]);
  });

  it('edits to a deleted row are skipped, not sent', async () => {
    const { store, calls, queue, d } = await withDest();
    const act = store.addActivity(d._key, '2026-02-23', { name: 'A' })!;
    await queue.idle();
    calls.length = 0;
    store.patchActivity(act._key, { notes: 'x' });
    store.removeActivity(act._key);
    store.flush();
    await queue.idle();
    expect(names(calls)).toEqual(['deleteActivity']);
    expect(queue.snapshot().issues).toEqual([]);
  });

  it('when the day cannot be created, its activities are dropped silently and the failure is reported once', async () => {
    const { store, api, queue, d } = await withDest();
    api.createDay.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 422 }));
    store.addActivity(d._key, '2026-02-23', { name: 'A' });
    store.addActivity(d._key, '2026-02-23', { name: 'B' });
    await queue.idle();
    expect(d.days).toHaveLength(0);
    expect(api.createActivity).not.toHaveBeenCalled();
    expect(queue.snapshot().issues).toHaveLength(1);
  });

  it('patchDay saves the label', async () => {
    const { store, calls, queue, d } = await withDest();
    const act = store.addActivity(d._key, '2026-02-23', { name: 'A' })!;
    await queue.idle();
    calls.length = 0;
    const day = store.locate(act._key)!.day!;
    store.patchDay(day._key, { label: 'Temples' });
    await vi.advanceTimersByTimeAsync(200);
    await queue.idle();
    expect(calls[0]).toMatchObject({ fn: 'updateDay', args: ['1', '100', day.id, { label: 'Temples' }] });
  });

  it('XSS-looking text is stored verbatim (views render it as text)', async () => {
    const { store, calls, queue, d } = await withDest();
    store.addActivity(d._key, '2026-02-23', { name: '<img src=x onerror=alert(1)>', notes: '"><script>1</script>' });
    await queue.idle();
    expect(calls.find((c) => c.fn === 'createActivity')!.args[3]).toMatchObject({ name: '<img src=x onerror=alert(1)>' });
  });
});

describe('hotel', () => {
  it('upserts, then removing it is undoable', async () => {
    const { store, calls, queue } = setup();
    const d = store.addDestination(kyoto);
    await queue.idle();
    calls.length = 0;
    store.setHotel(d._key, { name: 'Hotel Granvia', lat: 34.98, lng: 135.76 });
    await queue.idle();
    expect(calls[0]).toMatchObject({ fn: 'upsertHotel', args: ['1', '100', expect.objectContaining({ name: 'Hotel Granvia', check_in_date: '2026-02-22' })] });
    expect(d.hotel!.id).not.toMatch(/^tmp-/);
    store.removeHotel(d._key);
    expect(d.hotel).toBeNull();
    store.undoDelete();
    expect(d.hotel!.name).toBe('Hotel Granvia');
    store.removeHotel(d._key);
    await vi.advanceTimersByTimeAsync(1500);
    await queue.idle();
    expect(names(calls)).toEqual(['upsertHotel', 'deleteHotel']);
  });

  it('removing a hotel before its save went out sends nothing for it', async () => {
    const { store, calls, queue } = setup();
    const d = store.addDestination(kyoto); // queue is busy with this create
    store.setHotel(d._key, { name: 'H', lat: null, lng: null });
    store.removeHotel(d._key);
    store.flush();
    await queue.idle();
    expect(names(calls)).toEqual(['createDestination']);
    expect(queue.snapshot().issues).toEqual([]);
  });
});

describe('trip fields', () => {
  it('debounces, coalesces and merges the public slug from the answer', async () => {
    const { store, calls, queue } = setup();
    store.patchTrip({ name: 'J' });
    store.patchTrip({ name: 'Ja' });
    store.patchTrip({ is_public: true }, true);
    await queue.idle();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[1]).toEqual({ name: 'Ja', is_public: true });
    expect(store.trip.public_slug).toBe('slug-1');
  });

  it('notifies subscribers', () => {
    const { store } = setup();
    const kinds: string[] = [];
    store.subscribe((e) => kinds.push(e.kind));
    store.patchTrip({ description: 'x' });
    expect(kinds).toContain('trip');
  });
});

describe('failure handling', () => {
  it('a network failure keeps the local edit and the queue retries it', async () => {
    const { store, api, queue } = setup();
    const q2 = new SaveQueue({ retryDelaysMs: [10] });
    const s2 = new EditorStore(trip(), api, q2, { debounceMs: 10 });
    api.createDestination.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    s2.addDestination(kyoto);
    await vi.advanceTimersByTimeAsync(0);
    expect(q2.snapshot().status).toBe('error');
    expect(s2.trip.destinations).toHaveLength(1); // still there
    await vi.advanceTimersByTimeAsync(20);
    await q2.idle();
    expect(s2.trip.destinations[0]!.id).toBe('100');
    expect(store).toBeDefined();
    expect(queue).toBeDefined();
  });

  it('replaceTrip swaps in the server copy and drops buffered edits', () => {
    const { store } = setup();
    const d = store.addDestination(kyoto);
    store.patchDestination(d._key, { city_name: 'X' });
    store.replaceTrip(trip({ name: 'Server copy' }));
    expect(store.trip.name).toBe('Server copy');
    expect(store.trip.destinations).toEqual([]);
    expect(store.hasUnsynced()).toBe(true); // the create is still queued; replace is for after the queue drained
  });
});
