import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_USER_INDEX_CONFIG,
  UserIndexError,
  UserSearchIndex,
  isAbortError,
  type UserIndexDeps,
} from '@/modules/userSearchIndex';
import type { ApiTrip } from '@/types';
import { mkTrip } from './fixtures/searchTrips';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A trip's full version (what GET /trips/:id returns) and its bare list row. */
const full = (id: string, name = `Trip ${id}`, city = `City${id}`): ApiTrip =>
  mkTrip({ id, name, dests: [{ city, days: [{ date: '2026-01-01', acts: [`Act${id}`] }] }] });
const bare = (id: string, name = `Trip ${id}`): ApiTrip => mkTrip({ id, name, bare: true });

interface Harness {
  index: UserSearchIndex;
  listTrips: ReturnType<typeof vi.fn>;
  getTrip: ReturnType<typeof vi.fn>;
  clock: { t: number };
}

function harness(
  rows: ApiTrip[],
  details: Record<string, ApiTrip>,
  overrides: Partial<UserIndexDeps> = {},
): Harness {
  const clock = { t: 1_000_000 };
  const listTrips = vi.fn(async () => rows);
  const getTrip = vi.fn(async (id: string) => {
    const t = details[id];
    if (!t) throw Object.assign(new Error('nope'), { status: 404 });
    return t;
  });
  const index = new UserSearchIndex({
    listTrips,
    getTrip,
    now: () => clock.t,
    ...DEFAULT_USER_INDEX_CONFIG,
    ...overrides,
  });
  return { index, listTrips, getTrip, clock };
}

const titles = (s: { entries: Array<{ title: string }> }): string[] => s.entries.map((e) => e.title);

describe('UserSearchIndex: loading and caching', () => {
  it('lists the trips, fetches each one\'s details, and indexes everything', async () => {
    const h = harness([bare('1'), bare('2')], { '1': full('1'), '2': full('2') });
    const snap = await h.index.ensureLoaded();
    expect(h.listTrips).toHaveBeenCalledTimes(1);
    expect(h.getTrip.mock.calls.map((c) => c[0]).sort()).toEqual(['1', '2']);
    expect(snap.tripCount).toBe(2);
    expect(snap.partial).toBe(false);
    expect(titles(snap)).toEqual(expect.arrayContaining(['Trip 1', 'City1', 'Act1', 'Trip 2', 'City2', 'Act2']));
    expect(snap.tripEntries.map((e) => e.title)).toEqual(['Trip 1', 'Trip 2']);
  });

  it('serves the second call from memory', async () => {
    const h = harness([bare('1')], { '1': full('1') });
    await h.index.ensureLoaded();
    const again = await h.index.ensureLoaded();
    expect(h.listTrips).toHaveBeenCalledTimes(1);
    expect(h.getTrip).toHaveBeenCalledTimes(1);
    expect(titles(again)).toContain('Act1');
  });

  it('concurrent callers share one load', async () => {
    const list = defer<ApiTrip[]>();
    const h = harness([], {});
    h.listTrips.mockReturnValueOnce(list.promise);
    const a = h.index.ensureLoaded();
    const b = h.index.ensureLoaded();
    list.resolve([]);
    await Promise.all([a, b]);
    expect(h.listTrips).toHaveBeenCalledTimes(1);
  });

  it('uses details that came with the list (no per-trip requests)', async () => {
    const h = harness([full('1'), full('2')], {});
    await h.index.ensureLoaded();
    expect(h.getTrip).not.toHaveBeenCalled();
  });

  it('an account with no trips loads fine and says so', async () => {
    const h = harness([], {});
    const snap = await h.index.ensureLoaded();
    expect(snap.tripCount).toBe(0);
    expect(snap.entries).toEqual([]);
    expect(snap.partial).toBe(false);
  });

  it('reloads after the TTL', async () => {
    const h = harness([bare('1')], { '1': full('1') });
    await h.index.ensureLoaded();
    h.clock.t += DEFAULT_USER_INDEX_CONFIG.ttlMs - 1;
    await h.index.ensureLoaded();
    expect(h.listTrips).toHaveBeenCalledTimes(1);
    h.clock.t += 2;
    await h.index.ensureLoaded();
    expect(h.listTrips).toHaveBeenCalledTimes(2);
    // Unchanged trips keep their details: only the list is fetched again.
    expect(h.getTrip).toHaveBeenCalledTimes(1);
  });

  it('after the TTL, a renamed trip is fetched again and a deleted one disappears', async () => {
    const h = harness([bare('1'), bare('2')], { '1': full('1'), '2': full('2') });
    await h.index.ensureLoaded();
    h.listTrips.mockResolvedValueOnce([bare('1', 'Renamed')]);
    h.clock.t += DEFAULT_USER_INDEX_CONFIG.ttlMs + 1;
    const snap = await h.index.ensureLoaded();
    expect(snap.tripCount).toBe(1);
    expect(titles(snap)).not.toContain('Trip 2');
    expect(h.getTrip.mock.calls.filter((c) => c[0] === '1')).toHaveLength(2);
  });

  it('fetches the trip on screen first', async () => {
    const h = harness([bare('1'), bare('2'), bare('3')], { '1': full('1'), '2': full('2'), '3': full('3') }, { concurrency: 1 });
    await h.index.ensureLoaded({ priorityTripId: '3' });
    expect(h.getTrip.mock.calls.map((c) => c[0])).toEqual(['3', '1', '2']);
  });

  it('limits parallel detail requests', async () => {
    let running = 0;
    let peak = 0;
    const rows = Array.from({ length: 10 }, (_, i) => bare(String(i)));
    const h = harness(rows, {}, { concurrency: 3 });
    h.getTrip.mockImplementation(async (id: string) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return full(id);
    });
    await h.index.ensureLoaded();
    expect(peak).toBe(3);
    expect(h.getTrip).toHaveBeenCalledTimes(10);
  });

  it('only fetches details for the newest maxTrips and says the result is partial', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => bare(String(i)));
    const details = Object.fromEntries(rows.map((r) => [String(r.id), full(String(r.id))]));
    const h = harness(rows, details, { maxTrips: 4 });
    const snap = await h.index.ensureLoaded();
    expect(h.getTrip).toHaveBeenCalledTimes(4);
    expect(snap.tripCount).toBe(6);
    expect(snap.partial).toBe(true);
    // Every trip is still findable by name.
    expect(snap.tripEntries).toHaveLength(6);
  });
});

describe('UserSearchIndex: invalidation', () => {
  it('drops the cache so the next call fetches again', async () => {
    const h = harness([bare('1')], { '1': full('1') });
    await h.index.ensureLoaded();
    h.index.invalidate();
    expect(h.index.peek()).toBeNull();
    expect(h.index.isStale()).toBe(true);
    await h.index.ensureLoaded();
    expect(h.listTrips).toHaveBeenCalledTimes(2);
    expect(h.getTrip).toHaveBeenCalledTimes(2);
  });

  it('shows edits made after the first load', async () => {
    const h = harness([bare('1')], { '1': full('1') });
    expect(titles(await h.index.ensureLoaded())).toContain('Act1');
    h.getTrip.mockResolvedValue(mkTrip({ id: '1', name: 'Trip 1', dests: [{ city: 'City1', days: [{ date: '2026-01-01', acts: ['Edited act'] }] }] }));
    h.index.invalidate();
    const snap = await h.index.ensureLoaded();
    expect(titles(snap)).toContain('Edited act');
    expect(titles(snap)).not.toContain('Act1');
  });

  it('a load that was running during an invalidation never stores its (stale) result', async () => {
    const h = harness([], {});
    const staleList = defer<ApiTrip[]>();
    h.listTrips.mockReturnValueOnce(staleList.promise);
    h.listTrips.mockResolvedValue([full('fresh')]);

    const first = h.index.ensureLoaded();
    h.index.invalidate(); // an edit landed while the old request was in the air
    staleList.resolve([full('stale')]);
    const snap = await first;

    expect(titles(snap)).toContain('Trip fresh');
    expect(titles(snap)).not.toContain('Trip stale');
    expect(h.listTrips).toHaveBeenCalledTimes(2);
    expect(titles((await h.index.ensureLoaded()))).not.toContain('Trip stale');
  });

  it('a detail response that lands after an invalidation is discarded', async () => {
    const h = harness([bare('1')], {});
    const stale = defer<ApiTrip>();
    h.getTrip.mockReturnValueOnce(stale.promise);
    h.getTrip.mockResolvedValue(full('1', 'Trip 1', 'FreshCity'));

    const first = h.index.ensureLoaded();
    await vi.waitFor(() => expect(h.getTrip).toHaveBeenCalledTimes(1));
    h.index.invalidate();
    stale.resolve(full('1', 'Trip 1', 'StaleCity'));
    const snap = await first;
    expect(titles(snap)).toContain('FreshCity');
    expect(titles(snap)).not.toContain('StaleCity');
  });

  it('upsertTrip adds a trip without a request, and a bare row never downgrades details', async () => {
    const h = harness([], {});
    h.index.upsertTrip(full('9'));
    expect(titles(h.index.peek() ?? { entries: [] })).toEqual([]); // not "loaded" until a list was fetched
    h.index.upsertTrip(bare('9', 'Trip 9'));
    h.listTrips.mockResolvedValue([bare('9')]);
    const snap = await h.index.ensureLoaded();
    expect(h.getTrip).not.toHaveBeenCalled();
    expect(titles(snap)).toContain('Act9');
  });
});

describe('UserSearchIndex: seeding', () => {
  it('a list handed over by the page spares the list request; details are still fetched', async () => {
    const h = harness([], { '1': full('1') });
    h.index.seedList([bare('1')]);
    const snap = await h.index.ensureLoaded();
    expect(h.listTrips).not.toHaveBeenCalled();
    expect(h.getTrip).toHaveBeenCalledTimes(1);
    expect(titles(snap)).toContain('Act1');
  });
});

describe('UserSearchIndex: failures', () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    [{ status: 401 }, 'unauthorized'],
    [{ status: 403, code: 'email_not_verified' }, 'email-not-verified'],
    [{ status: 500 }, 'network'],
    [new TypeError('Failed to fetch'), 'network'],
  ] as const)('list failure %j is classified as %s', async (err, kind) => {
    const h = harness([], {});
    h.listTrips.mockRejectedValue(err);
    await expect(h.index.ensureLoaded()).rejects.toMatchObject({ name: 'UserIndexError', kind });
  });

  it('a list request that never answers times out instead of hanging', async () => {
    vi.useFakeTimers();
    const h = harness([], {});
    h.listTrips.mockReturnValue(new Promise(() => undefined));
    const p = h.index.ensureLoaded();
    const settled = expect(p).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(DEFAULT_USER_INDEX_CONFIG.timeoutMs + 1);
    await settled;
  });

  it('replays a recent failure instead of hammering the API, until retry', async () => {
    const h = harness([], {});
    h.listTrips.mockRejectedValueOnce({ status: 500 });
    await expect(h.index.ensureLoaded()).rejects.toBeInstanceOf(UserIndexError);
    await expect(h.index.ensureLoaded()).rejects.toBeInstanceOf(UserIndexError);
    expect(h.listTrips).toHaveBeenCalledTimes(1);
    expect(h.index.needsNetwork()).toBe(false);

    h.listTrips.mockResolvedValue([full('1')]);
    const snap = await h.index.ensureLoaded({ retry: true });
    expect(h.listTrips).toHaveBeenCalledTimes(2);
    expect(snap.tripCount).toBe(1);
  });

  it('tries again by itself once the cooldown has passed', async () => {
    const h = harness([], {});
    h.listTrips.mockRejectedValueOnce({ status: 500 });
    await expect(h.index.ensureLoaded()).rejects.toBeInstanceOf(UserIndexError);
    h.clock.t += 10_001;
    h.listTrips.mockResolvedValue([full('1')]);
    await expect(h.index.ensureLoaded()).resolves.toMatchObject({ tripCount: 1 });
  });

  it('some trips failing still yields results, flagged partial, and is not retried per keystroke', async () => {
    const h = harness([bare('1'), bare('2')], { '1': full('1') }); // trip 2 -> 404
    const snap = await h.index.ensureLoaded();
    expect(snap.partial).toBe(true);
    expect(titles(snap)).toContain('Act1');
    expect(titles(snap)).toContain('Trip 2'); // still findable by name
    await h.index.ensureLoaded();
    await h.index.ensureLoaded();
    expect(h.getTrip.mock.calls.filter((c) => c[0] === '2')).toHaveLength(1);
    // An explicit retry does try again.
    await h.index.ensureLoaded({ retry: true });
    expect(h.getTrip.mock.calls.filter((c) => c[0] === '2')).toHaveLength(2);
  });

  it('every detail request failing is an error (outage), not an empty-looking index', async () => {
    const h = harness([bare('1'), bare('2')], {});
    h.getTrip.mockRejectedValue({ status: 500 });
    await expect(h.index.ensureLoaded()).rejects.toMatchObject({ kind: 'network' });
    expect(h.index.isStale()).toBe(true);
  });

  it('stops waiting for slow details after the budget and returns what it has', async () => {
    vi.useFakeTimers();
    const h = harness([bare('1'), bare('2')], { '1': full('1') }, { concurrency: 2 });
    h.getTrip.mockImplementation((id: string) => (id === '1' ? Promise.resolve(full('1')) : new Promise(() => undefined)));
    const p = h.index.ensureLoaded();
    await vi.advanceTimersByTimeAsync(DEFAULT_USER_INDEX_CONFIG.budgetMs + 1);
    const snap = await p;
    expect(titles(snap)).toContain('Act1');
    expect(snap.partial).toBe(true);
  });
});

describe('UserSearchIndex: cancellation', () => {
  it('an aborted caller rejects at once with an AbortError', async () => {
    const h = harness([], {});
    h.listTrips.mockReturnValue(new Promise(() => undefined));
    const ctrl = new AbortController();
    const p = h.index.ensureLoaded({ signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toSatisfy(isAbortError);
  });

  it('an already-aborted signal does not start a request', async () => {
    const h = harness([bare('1')], {});
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(h.index.ensureLoaded({ signal: ctrl.signal })).rejects.toSatisfy(isAbortError);
    expect(h.listTrips).not.toHaveBeenCalled();
  });

  it('when the last waiter leaves, no further detail requests are started', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => bare(String(i)));
    const h = harness(rows, {}, { concurrency: 1 });
    const gate = defer<ApiTrip>();
    h.getTrip.mockReturnValueOnce(gate.promise);
    h.getTrip.mockImplementation(async (id: string) => full(id));

    const ctrl = new AbortController();
    const p = h.index.ensureLoaded({ signal: ctrl.signal });
    p.catch(() => undefined);
    await vi.waitFor(() => expect(h.getTrip).toHaveBeenCalledTimes(1));
    ctrl.abort();
    gate.resolve(full('0'));
    await new Promise((r) => setTimeout(r, 5));
    expect(h.getTrip).toHaveBeenCalledTimes(1);

    // The next search carries on with what is missing.
    const snap = await h.index.ensureLoaded();
    expect(h.getTrip).toHaveBeenCalledTimes(8);
    expect(snap.partial).toBe(false);
  });

  it('one caller aborting does not cancel the load another caller still waits on', async () => {
    const h = harness([bare('1')], { '1': full('1') });
    const list = defer<ApiTrip[]>();
    h.listTrips.mockReturnValueOnce(list.promise);
    const ctrl = new AbortController();
    const a = h.index.ensureLoaded({ signal: ctrl.signal });
    a.catch(() => undefined);
    const b = h.index.ensureLoaded();
    ctrl.abort();
    list.resolve([bare('1')]);
    const snap = await b;
    expect(titles(snap)).toContain('Act1');
  });
});

describe('UserSearchIndex: race between two loads after invalidate', () => {
  beforeEach(() => vi.useRealTimers());

  it('the newest data wins even when the older response arrives last', async () => {
    const h = harness([], {});
    const slow = defer<ApiTrip[]>();
    h.listTrips.mockReturnValueOnce(slow.promise);
    h.listTrips.mockResolvedValue([full('new')]);

    const first = h.index.ensureLoaded();
    h.index.invalidate();
    const second = await h.index.ensureLoaded();
    slow.resolve([full('old')]);
    await first;

    expect(titles(second)).toContain('Trip new');
    expect(titles(h.index.peek()!)).toContain('Trip new');
    expect(titles(h.index.peek()!)).not.toContain('Trip old');
  });
});
