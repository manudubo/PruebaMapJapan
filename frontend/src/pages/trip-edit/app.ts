/**
 * The editor shell: wires the store, the save queue, the three steps, the live
 * preview (map + demo-style cards), navigation (URL hash + Back button), the
 * save indicator, recovery banners and the undo snackbar.
 */

import { getTrip, createTrip, updateTrip, createDestination, updateDestination, deleteDestination, createDay, updateDay, deleteDay, upsertHotel, deleteHotel, createActivity, updateActivity, deleteActivity, reorderActivities } from '@/api/client';
import { setText } from '@/modules/dom';
import type { ApiTrip } from '@/types';
import { EditorStore, type EditorApi, type StoreEvent } from './store';
import { SaveQueue } from './saveQueue';
import { PlaceSearch } from './placeSearch';
import { pickHintText } from './ui/pickHint';
import { describeBanner, describeStatus } from './status';
import { formatHash, parseHash } from './nav';
import { routeStops, tripSummary, type ETrip } from './model';
import { cityPreview, visibleGroups } from './previewModel';
import { PreviewMap } from './ui/previewMap';
import { renderCityCards, renderRouteCards } from './ui/previewCards';
import { h, announce } from './ui/h';
import { byKey } from './ui/reconcile';
import { mountTripView } from './views/tripView';
import { mountRouteView } from './views/routeView';
import { mountCityView } from './views/cityView';
import { mountShareView } from './views/shareView';
import type { MountedView, TripFieldsInput, View, ViewCtx } from './views/types';

export const realApi: EditorApi = {
  updateTrip, createDestination, updateDestination, deleteDestination, createDay, updateDay, deleteDay,
  upsertHotel, deleteHotel, createActivity, updateActivity, deleteActivity, reorderActivities,
};

export interface EditorDeps {
  api: EditorApi;
  fetchTrip: (id: string) => Promise<ApiTrip>;
  makeTrip: (fields: TripFieldsInput) => Promise<ApiTrip>;
  createSearch: () => PlaceSearch;
}

export const realDeps: EditorDeps = {
  api: realApi,
  fetchTrip: getTrip,
  makeTrip: (f) => createTrip(f),
  createSearch: () => new PlaceSearch(),
};

const BLANK_TRIP: ApiTrip = {
  id: '', user_id: '', name: '', description: null, start_date: null, end_date: null,
  cover_image_url: null, is_public: false, public_slug: null, destinations: [],
};

const NARROW = '(max-width: 959px)';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Trip editor: #${id} is missing from the page`);
  return el;
}

export interface EditorApp {
  store: EditorStore;
  go(view: View): void;
}

export function mountEditor(initial: { trip: ApiTrip | null }, deps: EditorDeps = realDeps): EditorApp {
  let isNew = initial.trip === null;
  let queue = new SaveQueue({ isOnline: () => navigator.onLine !== false });
  let store = new EditorStore(initial.trip ?? BLANK_TRIP, deps.api, queue);

  const planHost = $('te-view');
  const stepsNav = $('te-steps');
  const banners = $('te-banners');
  const statusEl = $('save-status');
  const heading = $('trip-name-heading');
  const viewLink = $('te-view-link') as HTMLAnchorElement;
  const cardsHost = $('te-cards');
  const mapEl = $('map');
  const mapEmpty = $('te-map-empty');
  const pickBanner = $('te-pick-banner');
  const pickBannerText = $('te-pick-banner-text');
  const snackbar = $('te-snackbar');
  const snackbarMsg = $('te-snackbar-msg');
  const undoBtn = $('undo-btn');
  const tabPlan = $('te-tab-plan');
  const tabPreview = $('te-tab-preview');
  const planPane = $('te-plan');
  const previewPane = $('te-preview');

  let view: View = isNew ? { step: 'trip' } : viewFromHash(location.hash);
  let showAll = false;
  let mounted: MountedView | null = null;
  let pickCb: ((lat: number, lng: number) => void) | null = null;
  let pickSwitchedTab = false;
  let previewQueued = false;
  const unsubs: Array<() => void> = [];

  // ---- navigation -------------------------------------------------------------------
  function viewFromHash(hash: string): View {
    const nav = parseHash(hash);
    if (!nav) return { step: 'route' };
    if (nav.step !== 'city') return nav;
    const dest = store.trip.destinations.find((d) => d.id === nav.destId || d._key === nav.destId);
    return dest ? { step: 'city', destKey: dest._key, date: nav.date } : { step: 'route' };
  }

  function hashFor(v: View): string {
    if (v.step !== 'city') return formatHash({ step: v.step });
    const dest = store.dest(v.destKey);
    return formatHash({ step: 'city', destId: dest?.id ?? v.destKey, date: v.date });
  }

  function viewKey(v: View): string {
    return v.step === 'city' ? `city:${v.destKey}` : v.step;
  }

  function go(next: View): void {
    if (isNew && next.step !== 'trip') return;
    const sameScreen = viewKey(next) === viewKey(view) && mounted;
    const prev = view;
    view = next;
    const hash = hashFor(next);
    if (sameScreen) {
      if (location.hash !== hash) history.replaceState(null, '', hash);
      if (next.step === 'city' && prev.step === 'city' && prev.date !== next.date) {
        showAll = false;
        mounted?.setDate?.(next.date);
      }
      renderChrome();
      schedulePreview();
      return;
    }
    store.flush();
    if (!isNew && location.hash !== hash) history.pushState(null, '', hash);
    mountView();
    window.scrollTo?.({ top: 0 });
    renderChrome();
    schedulePreview();
    requestAnimationFrame(() => {
      const h2 = planHost.querySelector<HTMLElement>('h2');
      h2?.setAttribute('tabindex', '-1');
      h2?.focus({ preventScroll: true });
    });
  }

  function onPopState(): void {
    if (isNew) return;
    view = viewFromHash(location.hash);
    setTab('plan');
    mountView();
    renderChrome();
    schedulePreview();
  }

  // ---- views ------------------------------------------------------------------------------
  const ctx: ViewCtx = {
    get store() { return store; },
    go,
    createSearch: () => deps.createSearch(),
    pickOnMap(cb) {
      pickCb = cb;
      map.setPickMode(cb !== null);
      pickBanner.hidden = cb === null;
      if (cb) pickBannerText.textContent = pickHintText();
      if (cb && window.matchMedia(NARROW).matches) { setTab('preview'); pickSwitchedTab = true; }
      if (!cb && pickSwitchedTab) { pickSwitchedTab = false; setTab('plan'); }
    },
    isPicking: () => map.isPicking(),
    focusOnMap(key) {
      if (window.matchMedia(NARROW).matches) setTab('preview');
      map.openItem(key);
    },
    get isNew() { return isNew; },
    createTrip: async (fields) => {
      const created = await deps.makeTrip(fields);
      const next: ApiTrip = { ...BLANK_TRIP, ...created, destinations: created.destinations ?? [] };
      swapStore(next);
      isNew = false;
      history.replaceState(null, '', `${location.pathname}?tripId=${encodeURIComponent(String(created.id))}#route`);
      announce('Trip created. Now add your first destination.');
      go({ step: 'route' });
    },
    tripPageUrl: (id) => new URL(`trip.html?tripId=${encodeURIComponent(id)}`, location.href).href,
    publicPageUrl: (slug) => new URL(`trip.html?slug=${encodeURIComponent(slug)}`, location.href).href,
    copyText,
    highlight: (key) => map.highlight(key),
  };

  function mountView(): void {
    mounted?.destroy();
    planHost.replaceChildren();
    let m: MountedView;
    if (view.step === 'trip') m = mountTripView(ctx);
    else if (view.step === 'route') m = mountRouteView(ctx);
    else if (view.step === 'city') m = mountCityView(ctx, view.destKey, view.date);
    else m = mountShareView(ctx);
    mounted = m;
    planHost.append(m.el);
    if (view.step === 'city' && !store.dest(view.destKey)) { view = { step: 'route' }; mountView(); }
  }

  // ---- preview ------------------------------------------------------------------------------
  const map = new PreviewMap(mapEl, {
    onSelectStop: (destKey) => go({ step: 'city', destKey, date: null }),
    onSelectItem: (key) => {
      const row = byKey($('te-view').querySelector<HTMLElement>('.te-acts') ?? planHost, key);
      row?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      row?.classList.add('is-new');
      window.setTimeout(() => row?.classList.remove('is-new'), 1200);
    },
    onPick: (lat, lng) => pickCb?.(lat, lng),
    onDragEnd: (key, lat, lng) => {
      store.patchActivity(key, { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 }, true);
      announce('Pin moved');
    },
  });

  function schedulePreview(): void {
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(() => { previewQueued = false; renderPreview(); });
  }

  function renderPreview(): void {
    const handlers = {
      onOpenCity: (destKey: string) => go({ step: 'city', destKey, date: null }),
      onSelectDate: (date: string | null) => {
        if (view.step !== 'city') return;
        if (date === null) { showAll = true; renderPreview(); return; }
        showAll = false;
        go({ step: 'city', destKey: view.destKey, date });
      },
      onFocusItem: (key: string) => map.openItem(key),
    };
    const t = store.trip;
    if (view.step === 'city') {
      const dest = store.dest(view.destKey);
      if (dest) {
        const city = cityPreview(dest);
        const groups = visibleGroups(city, view.date, showAll);
        map.render({ kind: 'city', city, groups, editable: true });
        renderCityCards(cardsHost, { city, groups, activeDate: view.date, showAll }, handlers);
        mapEmpty.textContent = 'Places with a map location show up here as numbered markers.';
        mapEmpty.hidden = map.hasMarkers();
        return;
      }
    }
    const stops = routeStops(t);
    map.render({ kind: 'route', stops, selectedKey: null });
    const s = tripSummary(t);
    renderRouteCards(cardsHost, {
      stops,
      selectedKey: null,
      summary: s.cities ? `${s.cities} destination${s.cities === 1 ? '' : 's'} · ${s.places} place${s.places === 1 ? '' : 's'}` : '',
    }, handlers);
    mapEmpty.textContent = 'Search a city to start your route. It appears here with a dashed line between stops.';
    mapEmpty.hidden = map.hasMarkers();
  }

  // ---- chrome: heading, steps, status, banners, undo ---------------------------------------------
  function renderChrome(): void {
    const t = store.trip;
    setText(heading, isNew ? 'New trip' : t.name || 'Untitled trip');
    document.title = `${isNew ? 'New trip' : t.name || 'Untitled trip'} – Edit trip`;
    viewLink.hidden = isNew;
    if (!isNew) viewLink.href = ctx.tripPageUrl(t.id);

    const stepOf = view.step === 'city' ? 'route' : view.step;
    stepsNav.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((btn) => {
      const s = btn.dataset['step'];
      const current = s === stepOf;
      if (current) btn.setAttribute('aria-current', 'step'); else btn.removeAttribute('aria-current');
      btn.classList.toggle('is-current', current);
      btn.disabled = isNew && s !== 'trip';
    });
  }

  function renderSave(): void {
    const snap = queue.snapshot();
    const v = describeStatus(snap, store.hasUnsynced());
    statusEl.dataset['state'] = v.state;
    const text = statusEl.querySelector('.save-text');
    if (text && text.textContent !== v.text) text.textContent = v.text;

    const b = describeBanner(snap);
    const key = JSON.stringify(b);
    if (banners.dataset['key'] === key) return;
    banners.dataset['key'] = key;
    banners.replaceChildren();
    if (!b) return;
    const actions = h('div', { class: 'te-banner-actions' },
      b.retry ? h('button', { type: 'button', class: 'btn btn-primary btn-small', id: 'save-retry', text: 'Retry now', on: { click: () => queue.retry() } }) : null,
      b.reload ? h('button', { type: 'button', class: 'btn btn-primary btn-small', id: 'save-reload', text: 'Reload from server', on: { click: () => void reloadFromServer() } }) : null,
      b.kind === 'issues' ? h('button', { type: 'button', class: 'btn btn-secondary btn-small', id: 'save-dismiss', text: 'Dismiss', on: { click: () => queue.dismissIssues() } }) : null,
    );
    banners.append(h('div', { class: `te-banner te-banner--${b.kind}`, attrs: { role: b.kind === 'offline' ? 'status' : 'alert' } },
      h('div', { class: 'te-banner-text' }, h('strong', { text: b.title }), h('span', { text: b.detail })), actions));
  }

  async function reloadFromServer(): Promise<void> {
    store.flush();
    await queue.idle();
    try {
      const fresh = await deps.fetchTrip(store.trip.id);
      store.replaceTrip(fresh);
      queue.dismissIssues();
      mountView();
      renderChrome();
      schedulePreview();
    } catch {
      /* the banner stays; the user can try again */
    }
  }

  let snackTimer: ReturnType<typeof setTimeout> | null = null;
  function onUndo(u: { label: string } | null): void {
    if (snackTimer) { clearTimeout(snackTimer); snackTimer = null; }
    if (!u) { snackbar.hidden = true; return; }
    setText(snackbarMsg, `Deleted “${u.label}”`);
    snackbar.hidden = false;
  }
  undoBtn.addEventListener('click', () => {
    if (store.undoDelete()) announce('Restored');
  });

  // ---- store wiring ---------------------------------------------------------------------------------
  function wireStore(): void {
    unsubs.forEach((f) => f());
    unsubs.length = 0;
    unsubs.push(
      store.subscribe((e: StoreEvent) => {
        mounted?.update(e);
        if (e.kind === 'structure') relocateHash();
        renderChrome();
        renderSave();
        schedulePreview();
      }),
      queue.subscribe(() => renderSave()),
      store.onUndo(onUndo),
    );
  }

  /** A temporary id was replaced by the server's: keep the hash pointing at the real one. */
  function relocateHash(): void {
    if (isNew) return;
    const hash = hashFor(view);
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  function swapStore(trip: ApiTrip): void {
    store.flush();
    queue = new SaveQueue({ isOnline: () => navigator.onLine !== false });
    store = new EditorStore(trip, deps.api, queue);
    wireStore();
    renderSave();
  }

  // ---- tabs (narrow screens) --------------------------------------------------------------------------
  function setTab(tab: 'plan' | 'preview'): void {
    const preview = tab === 'preview';
    planPane.classList.toggle('is-active', !preview);
    previewPane.classList.toggle('is-active', preview);
    tabPlan.setAttribute('aria-selected', String(!preview));
    tabPreview.setAttribute('aria-selected', String(preview));
    tabPlan.tabIndex = preview ? -1 : 0;
    tabPreview.tabIndex = preview ? 0 : -1;
    if (preview) requestAnimationFrame(() => { map.invalidate(); schedulePreview(); });
  }
  tabPlan.addEventListener('click', () => setTab('plan'));
  tabPreview.addEventListener('click', () => setTab('preview'));
  for (const [a, b] of [[tabPlan, tabPreview], [tabPreview, tabPlan]] as const) {
    a.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); b.click(); b.focus(); }
    });
  }
  $('te-pick-cancel').addEventListener('click', () => { ctx.pickOnMap(null); (mounted && planHost.querySelector<HTMLElement>('#pick-pin'))?.focus(); });

  stepsNav.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-step]');
    if (!btn || btn.disabled) return;
    const s = btn.dataset['step'];
    if (s === 'trip' || s === 'route' || s === 'share') go({ step: s });
  });

  // ---- page lifecycle ------------------------------------------------------------------------------------
  window.addEventListener('popstate', onPopState);
  window.addEventListener('online', () => queue.setOnline(true));
  window.addEventListener('offline', () => queue.setOnline(false));
  window.addEventListener('beforeunload', (e) => {
    const s = queue.snapshot();
    if (store.hasUnsynced() || s.status === 'error' || s.status === 'offline') {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.addEventListener('pagehide', () => store.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // keep native text undo
      if (store.undoDelete()) { e.preventDefault(); announce('Restored'); }
    }
  });
  window.matchMedia?.(NARROW).addEventListener?.('change', () => { map.invalidate(); });
  window.addEventListener('resize', () => map.invalidate());

  // ---- go ----------------------------------------------------------------------------------------------------
  wireStore();
  if (!isNew && view.step === 'city' && !store.dest(view.destKey)) view = { step: 'route' };
  mountView();
  renderChrome();
  renderSave();
  setTab('plan');
  renderPreview();
  if (!isNew) {
    const hash = hashFor(view);
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  return { store, go };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export type { ETrip };
