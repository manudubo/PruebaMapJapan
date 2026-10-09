import type { EditorStore, StoreEvent } from '../store';
import type { PlaceSearch } from '../placeSearch';

/** Internal navigation state (the URL hash is derived from it, see app.ts). */
export type View =
  | { step: 'trip' }
  | { step: 'route' }
  | { step: 'city'; destKey: string; date: string | null }
  | { step: 'share' };

export interface TripFieldsInput {
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  cover_image_url: string | null;
}

/** What the views may ask of the app shell. */
export interface ViewCtx {
  store: EditorStore;
  go(view: View): void;
  /** Search box state machines are injectable so tests never touch the network. */
  createSearch(): PlaceSearch;
  /** Turn "click the map to drop a pin" on (with a callback) or off (null). */
  pickOnMap(cb: ((lat: number, lng: number) => void) | null): void;
  isPicking(): boolean;
  /** Pan the map to a place and open its popup. */
  focusOnMap(itemKey: string): void;
  /** New-trip mode: create the trip, then continue. */
  isNew: boolean;
  createTrip(fields: TripFieldsInput): Promise<void>;
  /** Absolute URLs for the trip page. */
  tripPageUrl(tripId: string): string;
  publicPageUrl(slug: string): string;
  copyText(text: string): Promise<boolean>;
  /** Mark which place the preview should highlight. */
  highlight(itemKey: string | null): void;
}

export interface MountedView {
  el: HTMLElement;
  /** React to a store change without rebuilding (keeps focus and typed text). */
  update(event: StoreEvent): void;
  /** City view only: the preview pane selected another day. */
  setDate?(date: string | null): void;
  destroy(): void;
}
