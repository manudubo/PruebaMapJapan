/**
 * In-memory search index over the signed-in user's own trips.
 *
 * GET /trips returns bare trip rows (no destinations), so cities, days and activities need one
 * GET /trips/:id per trip. This module owns that fan-out and what it costs:
 *  - one load at a time (callers share the in-flight promise), results cached for a while;
 *  - `invalidate()` after an edit drops everything, and a load that was running when it
 *    happened is discarded rather than stored (no stale data after a write);
 *  - bounded: request timeout, concurrency limit, trip cap, overall budget;
 *  - cancellable: when the last waiting caller aborts, no further requests are started.
 *
 * Nothing here touches the DOM. The API client is injected (and imported lazily by default) so
 * the demo pages never pay for it and tests can drive every path.
 */

import type { ApiTrip } from '@/types';
import type { SearchResult } from './search';
import { buildTripEntries } from './tripEntries';

export type UserIndexErrorKind =
  | 'timeout'
  | 'unauthorized'
  | 'email-not-verified'
  | 'network';

export class UserIndexError extends Error {
  readonly kind: UserIndexErrorKind;
  constructor(kind: UserIndexErrorKind, cause?: unknown) {
    super(`User trips unavailable (${kind})`);
    this.name = 'UserIndexError';
    this.kind = kind;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export interface UserIndexSnapshot {
  /** Every searchable entry, trips in the API's order (newest first). */
  entries: SearchResult[];
  /** One entry per trip: the list shown for an empty query. */
  tripEntries: SearchResult[];
  tripCount: number;
  /** Some trips' details are missing (a request failed, was cut off or the cap applied). */
  partial: boolean;
}

export interface UserIndexDeps {
  listTrips(): Promise<ApiTrip[]>;
  getTrip(id: string): Promise<ApiTrip>;
  now(): number;
  /** Per-request timeout. */
  timeoutMs: number;
  /** Overall budget for detail fetching after the list arrived. */
  budgetMs: number;
  /** Parallel GET /trips/:id requests. */
  concurrency: number;
  /** How long a loaded list stays fresh. */
  ttlMs: number;
  /** Most trips whose details are fetched (the list is newest first). */
  maxTrips: number;
}

export const DEFAULT_USER_INDEX_CONFIG = {
  timeoutMs: 8000,
  budgetMs: 12000,
  concurrency: 4,
  ttlMs: 5 * 60 * 1000,
  maxTrips: 50,
} as const;

interface TripRecord {
  trip: ApiTrip;
  entries: SearchResult[];
  /** Has destinations/days/activities (false for a bare list row). */
  detailed: boolean;
}

const ERROR_COOLDOWN_MS = 10_000;

function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function classify(err: unknown): UserIndexError {
  if (err instanceof UserIndexError) return err;
  const status = (err as { status?: unknown } | null)?.status;
  const code = (err as { code?: unknown } | null)?.code;
  if (status === 401) return new UserIndexError('unauthorized', err);
  if (status === 403 && code === 'email_not_verified') return new UserIndexError('email-not-verified', err);
  return new UserIndexError('network', err);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new UserIndexError('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export class UserSearchIndex {
  private readonly deps: UserIndexDeps;
  private records = new Map<string, TripRecord>();
  private order: string[] = [];
  private listedAt = 0;
  /** Bumped by invalidate(); a load started under an older value never stores its result. */
  private generation = 0;
  private version = 0;
  private snapshotCache: { version: number; value: UserIndexSnapshot } | null = null;
  private inflight: Promise<UserIndexSnapshot> | null = null;
  private waiters = 0;
  /** Trips whose details failed to load; not retried until `retry`, invalidate() or a new list. */
  private failed = new Set<string>();
  /** A recent load failure is replayed (not retried) for ERROR_COOLDOWN_MS so typing cannot hammer a dead API. */
  private lastError: { err: UserIndexError; at: number } | null = null;
  private truncated = false;

  constructor(deps: UserIndexDeps) {
    this.deps = deps;
  }

  /** True when a load would hit the network (nothing cached, expired or invalidated). */
  isStale(): boolean {
    return this.listedAt === 0 || this.deps.now() - this.listedAt > this.deps.ttlMs;
  }

  /** True when ensureLoaded() would have to wait on the network (and not just replay a recent failure). */
  needsNetwork(): boolean {
    if (this.lastError && this.deps.now() - this.lastError.at < ERROR_COOLDOWN_MS) return false;
    return this.isStale() || this.needsDetails();
  }

  /** What is cached right now, fresh or not; null when never loaded. */
  peek(): UserIndexSnapshot | null {
    return this.listedAt === 0 ? null : this.snapshot();
  }

  /** Drop everything; the next ensureLoaded() fetches again. */
  invalidate(): void {
    this.generation++;
    this.records = new Map();
    this.order = [];
    this.listedAt = 0;
    this.failed = new Set();
    this.lastError = null;
    this.truncated = false;
    this.inflight = null;
    this.bump();
  }

  /**
   * Add or refresh a trip the page already has. A bare list row never replaces details we
   * hold for the same trip.
   */
  upsertTrip(trip: ApiTrip): void {
    const id = String(trip.id);
    const detailed = Array.isArray(trip.destinations);
    const existing = this.records.get(id);
    if (existing?.detailed && !detailed) return;
    this.records.set(id, { trip, entries: buildTripEntries(trip), detailed });
    if (!this.order.includes(id)) this.order.unshift(id);
    this.bump();
  }

  /**
   * Treat `trips` as the complete, current list (a page that just fetched GET /trips can hand
   * it over so the first search skips that request). Bare rows still need their details.
   */
  seedList(trips: ApiTrip[]): void {
    this.applyList(trips);
    this.lastError = null;
  }

  /**
   * Resolve with the index, loading what is missing. Concurrent callers share one load.
   * `signal` aborts only this caller; the load is stopped when no caller is left waiting.
   * `priorityTripId` is fetched first so the trip on screen is searchable soonest.
   */
  ensureLoaded(
    options: { signal?: AbortSignal; priorityTripId?: string | null; retry?: boolean } = {},
  ): Promise<UserIndexSnapshot> {
    const { signal, priorityTripId = null, retry = false } = options;
    if (signal?.aborted) return Promise.reject(abortError());

    if (retry) {
      this.failed = new Set();
      this.lastError = null;
    } else if (this.lastError && this.deps.now() - this.lastError.at < ERROR_COOLDOWN_MS) {
      return Promise.reject(this.lastError.err);
    }

    if (!this.isStale() && !this.needsDetails()) return Promise.resolve(this.snapshot());

    // Count this caller before the load starts: the load stops launching requests at zero waiters.
    this.waiters++;
    const load = (this.inflight ??= this.load(priorityTripId));

    return new Promise<UserIndexSnapshot>((resolve, reject) => {
      let settled = false;
      const leave = (): void => {
        if (settled) return;
        settled = true;
        this.waiters--;
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        leave();
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      load.then(
        (v) => { if (!settled) { leave(); resolve(v); } },
        (e) => { if (!settled) { leave(); reject(e); } },
      );
    });
  }

  private needsDetails(): boolean {
    return this.order
      .slice(0, this.deps.maxTrips)
      .some((id) => !this.records.get(id)?.detailed && !this.failed.has(id));
  }

  private async load(priorityTripId: string | null): Promise<UserIndexSnapshot> {
    const generation = this.generation;
    const current = (): boolean => generation === this.generation;
    try {
      if (this.isStale()) {
        this.failed = new Set();
        let list: ApiTrip[];
        try {
          list = await withTimeout(this.deps.listTrips(), this.deps.timeoutMs);
        } catch (err) {
          throw classify(err);
        }
        if (!current()) return await this.restart(priorityTripId);
        this.applyList(Array.isArray(list) ? list : []);
      }

      const missing = this.order
        .slice(0, this.deps.maxTrips)
        .filter((id) => !this.records.get(id)?.detailed && !this.failed.has(id));
      if (priorityTripId) {
        const at = missing.indexOf(priorityTripId);
        if (at > 0) missing.unshift(...missing.splice(at, 1));
      }

      await this.fetchDetails(missing, current);
      if (!current()) return await this.restart(priorityTripId);
      return this.snapshot();
    } catch (err) {
      if (current() && err instanceof UserIndexError) this.lastError = { err, at: this.deps.now() };
      throw err;
    } finally {
      if (current()) this.inflight = null;
    }
  }

  /** An invalidate() landed mid-load: what was fetched is stale, so load again from scratch. */
  private restart(priorityTripId: string | null): Promise<UserIndexSnapshot> {
    this.inflight = null;
    return this.ensureLoaded({ priorityTripId });
  }

  private applyList(list: ApiTrip[]): void {
    const next = new Map<string, TripRecord>();
    const order: string[] = [];
    for (const row of list) {
      const id = String(row.id);
      order.push(id);
      const kept = this.records.get(id);
      const unchanged =
        kept?.detailed &&
        kept.trip.name === row.name &&
        kept.trip.start_date === row.start_date &&
        kept.trip.end_date === row.end_date;
      if (unchanged && kept && !Array.isArray(row.destinations)) {
        next.set(id, kept);
      } else {
        next.set(id, { trip: row, entries: buildTripEntries(row), detailed: Array.isArray(row.destinations) });
      }
    }
    this.records = next;
    this.order = order;
    this.truncated = order.length > this.deps.maxTrips;
    this.listedAt = this.deps.now();
    this.bump();
  }

  private async fetchDetails(ids: string[], current: () => boolean): Promise<void> {
    if (ids.length === 0) return;
    const queue = ids.slice();
    const worker = async (): Promise<void> => {
      while (queue.length > 0 && current() && this.waiters > 0) {
        const id = queue.shift() as string;
        try {
          const trip = await withTimeout(this.deps.getTrip(id), this.deps.timeoutMs);
          if (!current()) return;
          this.records.set(id, { trip, entries: buildTripEntries(trip), detailed: true });
          this.bump();
        } catch {
          this.failed.add(id);
        }
      }
    };
    const pool = Promise.all(
      Array.from({ length: Math.min(this.deps.concurrency, queue.length) }, worker),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<void>((resolve) => { timer = setTimeout(resolve, this.deps.budgetMs); });
    await Promise.race([pool.then(() => undefined), budget]);
    clearTimeout(timer);
    // The list loaded but not one trip's details did: that is an outage, not an empty account.
    if (current() && ids.every((id) => this.failed.has(id))) {
      const anyDetailed = [...this.records.values()].some((r) => r.detailed);
      if (!anyDetailed) {
        this.listedAt = 0; // nothing usable: do not report this list as loaded
        throw new UserIndexError('network');
      }
    }
  }

  private bump(): void {
    this.version++;
    this.snapshotCache = null;
  }

  private snapshot(): UserIndexSnapshot {
    if (this.snapshotCache?.version === this.version) return this.snapshotCache.value;
    const entries: SearchResult[] = [];
    const tripEntries: SearchResult[] = [];
    let partial = this.truncated || this.failed.size > 0;
    for (const id of this.order) {
      const record = this.records.get(id);
      if (!record) continue;
      entries.push(...record.entries);
      const head = record.entries[0];
      if (head) tripEntries.push(head);
      if (!record.detailed) partial = true;
    }
    const value: UserIndexSnapshot = { entries, tripEntries, tripCount: this.order.length, partial };
    this.snapshotCache = { version: this.version, value };
    return value;
  }
}

// ---------------------------------------------------------------------------
// Shared instance
// ---------------------------------------------------------------------------

// One lazy import shared by every request (the demo pages never load the client).
let clientModule: Promise<typeof import('@/api/client')> | null = null;
const client = (): Promise<typeof import('@/api/client')> => (clientModule ??= import('@/api/client'));

function defaultDeps(): UserIndexDeps {
  return {
    listTrips: async () => (await client()).getMyTrips(),
    getTrip: async (id) => (await client()).getTrip(id),
    now: () => Date.now(),
    ...DEFAULT_USER_INDEX_CONFIG,
  };
}

export const userSearchIndex = new UserSearchIndex(defaultDeps());

/** Trips changed (created, edited, deleted): the next search reloads. */
export function invalidateUserSearchIndex(): void {
  userSearchIndex.invalidate();
}

export function upsertUserTrip(trip: ApiTrip): void {
  userSearchIndex.upsertTrip(trip);
}

/** The page holds the user's complete trip list: let the search reuse it. */
export function seedUserSearchIndex(trips: ApiTrip[]): void {
  userSearchIndex.seedList(trips);
}
