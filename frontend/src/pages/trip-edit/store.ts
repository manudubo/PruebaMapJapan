/**
 * The editor's state and its persistence.
 *
 * Every mutation is applied to the in-memory trip immediately (optimistic) and
 * queued as one API call on the SaveQueue. The trip is plain mutable objects
 * addressed by their stable client `_key`; server ids are filled in when the
 * create call answers, and calls read the current id/values at run time so a
 * quick edit after "add" still lands on the right row.
 *
 *  - field edits are debounced per row and coalesced into one PATCH
 *  - deletes are deferred: the row disappears at once, "Undo" brings it back,
 *    the DELETE is only sent once the undo window closes
 *  - failed creates that the server refuses for good are rolled back locally
 */

import type * as Client from '@/api/client';
import type { ApiTrip } from '@/types';
import { SaveQueue, SkipOp, type QueueOp } from './saveQueue';
import {
  dayChips,
  dayColor,
  dominantCountry,
  moveItem,
  newKey,
  newTempId,
  nextOrderIndex,
  normalizeTrip,
  suggestDestinationDates,
  isTempId,
  type EActivity,
  type EDay,
  type EDest,
  type EHotel,
  type ETrip,
  type Place,
} from './model';

export type EditorApi = Pick<
  typeof Client,
  | 'updateTrip'
  | 'createDestination' | 'updateDestination' | 'deleteDestination'
  | 'createDay' | 'updateDay' | 'deleteDay'
  | 'upsertHotel' | 'deleteHotel'
  | 'createActivity' | 'updateActivity' | 'deleteActivity' | 'reorderActivities'
>;

/** What changed, so views re-render only what they must. */
export type StoreEvent =
  | { kind: 'structure' } // rows added / removed / moved / ids resolved
  | { kind: 'field' }     // a value of an existing row changed
  | { kind: 'trip' };     // trip-level fields (name, dates, public)

export interface UndoInfo {
  label: string;
}

export interface StoreOptions {
  debounceMs?: number;
  undoMs?: number;
}

export const DEFAULT_ZOOM = 12;

type ActivityFields = Partial<Pick<EActivity, 'name' | 'time' | 'notes' | 'maps_url' | 'is_optional' | 'is_generic' | 'lat' | 'lng'>>;
type DestFields = Partial<Pick<EDest, 'city_name' | 'country' | 'start_date' | 'end_date' | 'zoom_level' | 'lat' | 'lng'>>;
type TripFields = Partial<Pick<ETrip, 'name' | 'description' | 'start_date' | 'end_date' | 'is_public' | 'cover_image_url'>>;
type DayFields = Partial<Pick<EDay, 'label' | 'color_hex'>>;

interface Pending {
  fields: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  enqueue: (fields: string[]) => void;
}

interface Located {
  dest: EDest;
  day?: EDay;
  act?: EActivity;
}

function pick<T extends object>(source: T, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (source as Record<string, unknown>)[k] ?? null;
  return out;
}

export class EditorStore {
  trip: ETrip;
  readonly queue: SaveQueue;
  private listeners = new Set<(e: StoreEvent) => void>();
  private undoListeners = new Set<(u: UndoInfo | null) => void>();
  private pending = new Map<string, Pending>();
  private reorderQueued = new Set<string>();
  private lastDelete: { label: string; undo: () => void; commit: () => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private readonly debounceMs: number;
  private readonly undoMs: number;

  constructor(trip: ApiTrip, private readonly api: EditorApi, queue = new SaveQueue(), opts: StoreOptions = {}) {
    this.trip = normalizeTrip(trip);
    this.queue = queue;
    this.debounceMs = opts.debounceMs ?? 600;
    this.undoMs = opts.undoMs ?? 7000;
  }

  // ---- subscriptions ------------------------------------------------------

  subscribe(fn: (e: StoreEvent) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  onUndo(fn: (u: UndoInfo | null) => void): () => void {
    this.undoListeners.add(fn);
    return () => { this.undoListeners.delete(fn); };
  }

  private emit(kind: StoreEvent['kind']): void {
    for (const fn of this.listeners) fn({ kind });
  }

  private emitUndo(u: UndoInfo | null): void {
    for (const fn of this.undoListeners) fn(u);
  }

  // ---- lookup ---------------------------------------------------------------

  locate(key: string): Located | null {
    for (const dest of this.trip.destinations) {
      if (dest._key === key) return { dest };
      for (const day of dest.days) {
        if (day._key === key) return { dest, day };
        for (const act of day.activities) if (act._key === key) return { dest, day, act };
      }
    }
    return null;
  }

  dest(key: string): EDest | undefined {
    return this.trip.destinations.find((d) => d._key === key);
  }

  private liveId(id: string): string {
    if (isTempId(id)) throw new SkipOp('row not created');
    return id;
  }

  private tripId(): string {
    return this.trip.id;
  }

  // ---- unsynced work ----------------------------------------------------------

  /** Edits that are not yet confirmed by the server (debounced, queued, or deferred deletes). */
  hasUnsynced(): boolean {
    return this.pending.size > 0 || this.queue.hasPending() || this.lastDelete !== null;
  }

  /** Send everything buffered now: debounced edits and the pending delete. Call on blur / step change / page hide. */
  flush(): void {
    for (const p of [...this.pending.values()]) {
      if (p.timer) clearTimeout(p.timer);
      p.timer = null;
      const fields = [...p.fields];
      p.fields.clear();
      p.enqueue(fields);
    }
    this.pending.clear();
    this.commitDelete();
  }

  /**
   * Debounced, coalesced field save for one row. `enqueue` builds the queue op
   * with the then-current values of `fields`.
   */
  private schedule(rowKey: string, fields: string[], enqueue: (fields: string[]) => void, immediate = false): void {
    let p = this.pending.get(rowKey);
    if (!p) {
      p = { fields: new Set(), timer: null, enqueue };
      this.pending.set(rowKey, p);
    }
    for (const f of fields) p.fields.add(f);
    p.enqueue = enqueue;
    if (p.timer) clearTimeout(p.timer);
    const fire = (): void => {
      const entry = this.pending.get(rowKey);
      if (!entry) return;
      this.pending.delete(rowKey);
      entry.timer = null;
      enqueue([...entry.fields]);
    };
    if (immediate) fire();
    else p.timer = setTimeout(fire, this.debounceMs);
  }

  private op(op: QueueOp): void {
    this.queue.enqueue(op);
  }

  // ---- trip -------------------------------------------------------------------

  patchTrip(fields: TripFields, immediate = false): void {
    Object.assign(this.trip, fields);
    this.emit('trip');
    this.schedule('trip', Object.keys(fields), (keys) => {
      this.op({
        label: 'Save trip details',
        run: async () => {
          const res = await this.api.updateTrip(this.tripId(), pick(this.trip, keys) as Parameters<EditorApi['updateTrip']>[1]);
          const slug = (res as { public_slug?: string | null } | undefined)?.public_slug;
          if (slug !== undefined && slug !== this.trip.public_slug) {
            this.trip.public_slug = slug;
            this.emit('trip');
          }
        },
      });
    }, immediate);
  }

  // ---- destinations -------------------------------------------------------------

  /** Add a destination for a searched place; dates are suggested to follow the previous one. */
  addDestination(place: Place, nights = 2): EDest {
    const dates = suggestDestinationDates(this.trip, this.trip.destinations, nights);
    const dest: EDest = {
      _key: newKey('c'),
      id: newTempId(),
      trip_id: this.trip.id,
      city_name: place.name,
      country: place.country || dominantCountry(this.trip.destinations) || '—',
      start_date: dates.start_date,
      end_date: dates.end_date,
      lat: place.lat,
      lng: place.lng,
      zoom_level: DEFAULT_ZOOM,
      order_index: nextOrderIndex(this.trip.destinations),
      days: [],
      hotel: null,
    };
    this.trip.destinations.push(dest);
    this.emit('structure');
    this.op({
      label: `Add ${dest.city_name}`,
      run: async () => {
        const created = await this.api.createDestination(this.tripId(), {
          city_name: dest.city_name,
          country: dest.country,
          start_date: dest.start_date,
          end_date: dest.end_date,
          lat: dest.lat,
          lng: dest.lng,
          zoom_level: dest.zoom_level,
          order_index: dest.order_index,
        });
        dest.id = String(created.id);
        this.emit('structure');
      },
      onDrop: () => this.dropDestination(dest._key),
    });
    return dest;
  }

  private dropDestination(key: string): void {
    const i = this.trip.destinations.findIndex((d) => d._key === key);
    if (i >= 0) {
      this.trip.destinations.splice(i, 1);
      this.emit('structure');
    }
  }

  patchDestination(key: string, fields: DestFields, immediate = false): void {
    const dest = this.dest(key);
    if (!dest) return;
    Object.assign(dest, fields);
    this.emit('field');
    this.schedule(`dest:${key}`, Object.keys(fields), (keys) => {
      this.op({
        label: `Save ${dest.city_name}`,
        run: async () => {
          if (!this.dest(key)) throw new SkipOp('deleted');
          await this.api.updateDestination(this.tripId(), this.liveId(dest.id), pick(dest, keys) as Parameters<EditorApi['updateDestination']>[2]);
        },
      });
    }, immediate);
    if ('start_date' in fields || 'end_date' in fields) this.emit('structure');
  }

  /** Move a destination to `toIndex` in the route (0-based). Renumbers and saves changed order_index values. */
  moveDestination(key: string, toIndex: number): void {
    const from = this.trip.destinations.findIndex((d) => d._key === key);
    if (from < 0) return;
    const moved = moveItem(this.trip.destinations, from, toIndex);
    if (moved === this.trip.destinations) return;
    const before = new Map(this.trip.destinations.map((d) => [d._key, d.order_index]));
    // renumber in place: queued ops and views hold row references
    moved.forEach((d, i) => { d.order_index = i; });
    this.trip.destinations = moved;
    this.emit('structure');
    for (const d of this.trip.destinations) {
      if (before.get(d._key) !== d.order_index) {
        this.schedule(`dest:${d._key}`, ['order_index'], (keys) => {
          this.op({
            label: `Reorder ${d.city_name}`,
            run: async () => {
              const live = this.dest(d._key);
              if (!live) throw new SkipOp('deleted');
              await this.api.updateDestination(this.tripId(), this.liveId(live.id), pick(live, keys) as Parameters<EditorApi['updateDestination']>[2]);
            },
          });
        }, true);
      }
    }
  }

  removeDestination(key: string): void {
    const i = this.trip.destinations.findIndex((d) => d._key === key);
    if (i < 0) return;
    const dest = this.trip.destinations[i]!;
    this.trip.destinations.splice(i, 1);
    this.emit('structure');
    this.deferDelete(`${dest.city_name}`, () => {
      this.trip.destinations.splice(Math.min(i, this.trip.destinations.length), 0, dest);
      this.emit('structure');
    }, () => {
      this.op({
        label: `Delete ${dest.city_name}`,
        run: async () => { await this.api.deleteDestination(this.tripId(), this.liveId(dest.id)); },
      });
    });
  }

  // ---- hotel ------------------------------------------------------------------------

  setHotel(destKey: string, h: { name: string; lat: number | null; lng: number | null; url?: string | null }): void {
    const dest = this.dest(destKey);
    if (!dest) return;
    const hotel: EHotel = dest.hotel ?? {
      _key: newKey('h'), id: newTempId(), name: h.name, lat: h.lat, lng: h.lng,
      check_in_date: dest.start_date, check_out_date: dest.end_date, url: null,
    };
    hotel.name = h.name;
    hotel.lat = h.lat;
    hotel.lng = h.lng;
    if (h.url !== undefined) hotel.url = h.url;
    dest.hotel = hotel;
    this.emit('structure');
    this.schedule(`hotel:${destKey}`, ['name'], () => {
      this.op({
        label: `Save hotel for ${dest.city_name}`,
        run: async () => {
          if (!this.dest(destKey) || dest.hotel !== hotel) throw new SkipOp('gone');
          const saved = await this.api.upsertHotel(this.tripId(), this.liveId(dest.id), {
            name: hotel.name,
            lat: hotel.lat,
            lng: hotel.lng,
            url: hotel.url ?? null,
            check_in_date: hotel.check_in_date,
            check_out_date: hotel.check_out_date,
          });
          if (isTempId(hotel.id)) hotel.id = String(saved.id);
        },
      });
    }, true);
  }

  removeHotel(destKey: string): void {
    const dest = this.dest(destKey);
    const hotel = dest?.hotel;
    if (!dest || !hotel) return;
    dest.hotel = null;
    this.emit('structure');
    this.deferDelete(hotel.name, () => { dest.hotel = hotel; this.emit('structure'); }, () => {
      this.op({
        label: `Remove hotel from ${dest.city_name}`,
        run: async () => {
          // Never saved (its upsert was skipped because the hotel was removed first): nothing to delete.
          if (isTempId(hotel.id)) throw new SkipOp('hotel never saved');
          await this.api.deleteHotel(this.tripId(), this.liveId(dest.id));
        },
      });
    });
  }

  // ---- days ---------------------------------------------------------------------------

  /** The day row for `date`, creating it (locally now, on the server in order) when it only exists as a chip. */
  ensureDay(destKey: string, date: string): EDay | null {
    const dest = this.dest(destKey);
    if (!dest) return null;
    const existing = dest.days.find((d) => d.date === date);
    if (existing) return existing;
    const chips = dayChips(dest);
    const idx = Math.max(0, chips.findIndex((c) => c.date === date));
    const day: EDay = {
      _key: newKey('d'),
      id: newTempId(),
      date,
      label: null,
      color_hex: dayColor(idx),
      order_index: nextOrderIndex(dest.days),
      activities: [],
    };
    dest.days.push(day);
    dest.days.sort((a, b) => a.date.localeCompare(b.date) || a.order_index - b.order_index);
    this.emit('structure');
    this.op({
      label: `Add day ${date}`,
      run: async () => {
        const created = await this.api.createDay(this.tripId(), this.liveId(dest.id), {
          date: day.date, label: day.label, color_hex: day.color_hex, order_index: day.order_index,
        });
        day.id = String(created.id);
        this.emit('structure');
      },
      onDrop: () => {
        const i = dest.days.indexOf(day);
        if (i >= 0) { dest.days.splice(i, 1); this.emit('structure'); }
      },
    });
    return day;
  }

  patchDay(dayKey: string, fields: DayFields): void {
    const loc = this.locate(dayKey);
    if (!loc?.day) return;
    const { dest, day } = loc;
    Object.assign(day, fields);
    this.emit('field');
    this.schedule(`day:${dayKey}`, Object.keys(fields), (keys) => {
      this.op({
        label: `Save ${day.date}`,
        run: async () => {
          if (!this.locate(dayKey)) throw new SkipOp('deleted');
          await this.api.updateDay(this.tripId(), this.liveId(dest.id), this.liveId(day.id), pick(day, keys) as Parameters<EditorApi['updateDay']>[3]);
        },
      });
    });
  }

  // ---- activities -------------------------------------------------------------------------

  addActivity(destKey: string, date: string, data: ActivityFields & { name: string }): EActivity | null {
    const day = this.ensureDay(destKey, date);
    const dest = this.dest(destKey);
    if (!day || !dest) return null;
    const act: EActivity = {
      _key: newKey('a'),
      id: newTempId(),
      name: data.name,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      notes: data.notes ?? null,
      time: data.time ?? null,
      maps_url: data.maps_url ?? null,
      is_optional: data.is_optional ?? false,
      is_generic: data.is_generic ?? false,
      order_index: nextOrderIndex(day.activities),
    };
    day.activities.push(act);
    this.emit('structure');
    this.op({
      label: `Add ${act.name}`,
      run: async () => {
        const created = await this.api.createActivity(this.tripId(), this.liveId(dest.id), this.liveId(day.id), {
          name: act.name, lat: act.lat, lng: act.lng, notes: act.notes, time: act.time,
          maps_url: act.maps_url, is_optional: act.is_optional, is_generic: act.is_generic,
          order_index: act.order_index,
        });
        act.id = String(created.id);
        this.emit('structure');
      },
      onDrop: () => {
        const i = day.activities.indexOf(act);
        if (i >= 0) { day.activities.splice(i, 1); this.emit('structure'); }
      },
    });
    return act;
  }

  patchActivity(actKey: string, fields: ActivityFields, immediate = false): void {
    const loc = this.locate(actKey);
    if (!loc?.act || !loc.day) return;
    const { dest, day, act } = loc;
    Object.assign(act, fields);
    this.emit('field');
    this.schedule(`act:${actKey}`, Object.keys(fields), (keys) => {
      this.op({
        label: `Save ${act.name}`,
        run: async () => {
          if (!this.locate(actKey)) throw new SkipOp('deleted');
          await this.api.updateActivity(this.tripId(), this.liveId(dest.id), this.liveId(day.id), this.liveId(act.id),
            pick(act, keys) as Parameters<EditorApi['updateActivity']>[4]);
        },
      });
    }, immediate);
  }

  /** Move an activity within its day to `toIndex`. Rapid moves collapse into one reorder call. */
  moveActivity(actKey: string, toIndex: number): void {
    const loc = this.locate(actKey);
    if (!loc?.act || !loc.day) return;
    const { dest, day } = loc;
    const from = day.activities.findIndex((a) => a._key === actKey);
    const moved = moveItem(day.activities, from, toIndex);
    if (moved === day.activities) return;
    // renumber in place: queued ops hold row references
    moved.forEach((a, i) => { a.order_index = i; });
    day.activities = moved;
    this.emit('structure');
    if (this.reorderQueued.has(day._key)) return;
    this.reorderQueued.add(day._key);
    this.op({
      label: 'Save order',
      run: async () => {
        this.reorderQueued.delete(day._key);
        if (!this.locate(day._key)) throw new SkipOp('deleted');
        const ids = day.activities.map((a) => Number(this.liveId(a.id)));
        await this.api.reorderActivities(this.tripId(), this.liveId(dest.id), this.liveId(day.id), ids);
      },
    });
  }

  removeActivity(actKey: string): void {
    const loc = this.locate(actKey);
    if (!loc?.act || !loc.day) return;
    const { dest, day, act } = loc;
    const i = day.activities.indexOf(act);
    day.activities.splice(i, 1);
    this.emit('structure');
    this.deferDelete(act.name, () => {
      day.activities.splice(Math.min(i, day.activities.length), 0, act);
      this.emit('structure');
    }, () => {
      this.op({
        label: `Delete ${act.name}`,
        run: async () => { await this.api.deleteActivity(this.tripId(), this.liveId(dest.id), this.liveId(day.id), this.liveId(act.id)); },
      });
    });
  }

  // ---- deferred delete + undo ----------------------------------------------------------------

  private deferDelete(label: string, undo: () => void, commit: () => void): void {
    this.commitDelete(); // one undo window at a time: the previous delete is final now
    const timer = setTimeout(() => this.commitDelete(), this.undoMs);
    this.lastDelete = { label, undo, commit, timer };
    this.emitUndo({ label });
  }

  /** Make the pending delete final (sends the DELETE). */
  commitDelete(): void {
    const d = this.lastDelete;
    if (!d) return;
    clearTimeout(d.timer);
    this.lastDelete = null;
    d.commit();
    this.emitUndo(null);
  }

  /** Undo the last delete, if its window is still open. */
  undoDelete(): boolean {
    const d = this.lastDelete;
    if (!d) return false;
    clearTimeout(d.timer);
    this.lastDelete = null;
    d.undo();
    this.emitUndo(null);
    return true;
  }

  // ---- reload ---------------------------------------------------------------------------------

  /** Replace everything with the server's copy (after a refused change). */
  replaceTrip(trip: ApiTrip): void {
    for (const p of this.pending.values()) if (p.timer) clearTimeout(p.timer);
    this.pending.clear();
    this.trip = normalizeTrip(trip);
    this.emit('structure');
    this.emit('trip');
  }
}
