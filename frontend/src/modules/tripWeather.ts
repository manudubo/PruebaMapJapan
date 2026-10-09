/**
 * Weather on the saved-trip city view: the demo's weather card (same markup and classes, see
 * widgets.ts), fed by the destination's own coordinates and dates.
 *
 * Open-Meteo is keyless and already allowed by the CSP (`connect-src https://api.open-meteo.com`).
 * The card must never get in the way of the itinerary, so:
 *  - it loads lazily, with a short timeout, and every failure is contained (nothing throws);
 *  - an unreachable API (offline, network error, timeout) hides the card and retries once the
 *    browser is back online; an API that answers badly (HTTP error, malformed or empty JSON)
 *    shows a short message with "Try again";
 *  - only numbers and fixed strings from the response are rendered, via DOM APIs (no HTML from
 *    the network ever reaches innerHTML; the SVG icons are hardcoded literals).
 *
 * The decision logic (which days, which URL, what a payload means) is pure and unit-tested.
 */

import { addDays, formatIsoDate, isIsoDate, toIsoDate } from './dates';
import { toCoords } from './tripAdapter';
import { clearCache, getCache, setCache } from './utils';
import { getWeatherCondition, getWeatherIcon } from './weatherIcons';

/** Open-Meteo serves up to 16 forecast days; stay clear of the edge (timezones shift "today"). */
export const FORECAST_HORIZON_DAYS = 14;
/** Days shown, like the demo: today's headline plus four more. */
export const MAX_WINDOW_DAYS = 5;
/** Longer than this and the card gives up (the page never waits for it). */
export const WEATHER_TIMEOUT_MS = 8000;

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

// ---------------------------------------------------------------------------
// Which days
// ---------------------------------------------------------------------------

export type CurrentReason = 'undated' | 'past' | 'beyond';

export type ForecastWindow =
  | { kind: 'range'; start: string; end: string }
  | { kind: 'current'; reason: CurrentReason };

/**
 * The forecast for the destination's stay when it falls inside the forecast horizon (clipped to
 * today..today+14 and at most five days from its first day), else the current weather and the
 * next days, as on the demo pages.
 *
 * A stay with only a start counts as open-ended; with only an end, as a one-day stay on it. An
 * end before the start is read as a one-day stay.
 */
export function pickForecastWindow(
  start: string | null | undefined,
  end: string | null | undefined,
  today: string,
): ForecastWindow {
  const s = isIsoDate(start) ? start : null;
  const e = isIsoDate(end) ? end : null;
  const first = s ?? e;
  if (!first) return { kind: 'current', reason: 'undated' };
  // Only a start: open-ended, so the first days from it. An end before the start: a one-day stay.
  const last = e ? (s && e < s ? first : e) : addDays(first, MAX_WINDOW_DAYS - 1)!;

  const horizon = addDays(today, FORECAST_HORIZON_DAYS);
  if (horizon === null || !isIsoDate(today)) return { kind: 'current', reason: 'undated' };
  if (last < today) return { kind: 'current', reason: 'past' };
  if (first > horizon) return { kind: 'current', reason: 'beyond' };

  const from = first < today ? today : first;
  const cap = addDays(from, MAX_WINDOW_DAYS - 1)!;
  const to = [last, horizon, cap].reduce((min, d) => (d < min ? d : min));
  return { kind: 'range', start: from, end: to };
}

/** Request URL for a window (coordinates rounded to ~1 km: better cache hits, nothing finer sent). */
export function buildForecastUrl(lat: number, lng: number, period: ForecastWindow): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lng.toFixed(2),
    current: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
  });
  if (period.kind === 'range') {
    params.set('start_date', period.start);
    params.set('end_date', period.end);
  } else {
    params.set('forecast_days', String(MAX_WINDOW_DAYS));
  }
  return `${ENDPOINT}?${params}`;
}

export function cacheKeyFor(lat: number, lng: number, period: ForecastWindow): string {
  const where = `${lat.toFixed(2)}_${lng.toFixed(2)}`;
  return period.kind === 'range'
    ? `trip_weather_v1_${where}_${period.start}_${period.end}`
    : `trip_weather_v1_${where}_current`;
}

// ---------------------------------------------------------------------------
// What a response means
// ---------------------------------------------------------------------------

export interface WeatherDay {
  date: string;
  code: number;
  max: number;
  min: number;
}

export interface WeatherView {
  period: ForecastWindow;
  /** Large number of the card: the current temperature, or the first day's high. */
  headline: { kind: 'now' | 'high'; temp: number; code: number; date: string | null };
  /** The days after the headline's (at most four). */
  days: WeatherDay[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate an Open-Meteo payload (untrusted: HTTP 200 does not mean it is shaped as asked) and
 * turn it into what the card shows. null when it cannot be used at all (malformed, empty).
 * Days with missing numbers are dropped rather than rendered as "NaN°".
 */
export function parseForecast(payload: unknown, period: ForecastWindow, today: string): WeatherView | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { current, daily } = payload as { current?: unknown; daily?: unknown };
  if (typeof daily !== 'object' || daily === null) return null;
  const d = daily as Record<string, unknown>;
  const { time, weather_code: codes, temperature_2m_max: maxes, temperature_2m_min: mins } = d;
  if (!Array.isArray(time) || !Array.isArray(codes) || !Array.isArray(maxes) || !Array.isArray(mins)) return null;

  const all: WeatherDay[] = [];
  time.slice(0, 16).forEach((date: unknown, i) => {
    if (typeof date !== 'string' || !isIsoDate(date)) return;
    const [code, max, min] = [codes[i], maxes[i], mins[i]];
    if (isNum(code) && isNum(max) && isNum(min)) all.push({ date, code, max, min });
  });
  const days = all.slice(0, MAX_WINDOW_DAYS);
  if (days.length === 0) return null;

  const cur = typeof current === 'object' && current !== null ? (current as Record<string, unknown>) : null;
  const nowTemp = cur?.['temperature_2m'];
  const nowCode = cur?.['weather_code'];
  const showNow =
    (period.kind === 'current' || period.start === today) && isNum(nowTemp) && isNum(nowCode);

  const first = days[0]!;
  return {
    period,
    headline: showNow
      ? { kind: 'now', temp: nowTemp, code: nowCode, date: null }
      : { kind: 'high', temp: first.max, code: first.code, date: first.date },
    days: days.slice(1),
  };
}

const CURRENT_NOTES: Record<CurrentReason, string> = {
  undated: 'No dates for this stay yet, so this is the current weather.',
  past: 'This stay is over. Showing the current weather.',
  beyond: 'This stay is more than two weeks away, beyond the forecast. Showing the current weather.',
};

/** One line saying which days the card is about. */
export function describePeriod(period: ForecastWindow): string {
  if (period.kind === 'current') return CURRENT_NOTES[period.reason];
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions): string => formatIsoDate(iso, o, 'en-GB');
  if (period.start === period.end) return `Forecast for ${fmt(period.start, { day: 'numeric', month: 'short' })}`;
  const sameMonth = period.start.slice(0, 7) === period.end.slice(0, 7);
  const from = fmt(period.start, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
  return `Forecast for ${from}–${fmt(period.end, { day: 'numeric', month: 'short' })}`;
}

// ---------------------------------------------------------------------------
// Rendering (DOM APIs only; SVG icons are hardcoded literals)
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(code: number, className: string): HTMLElement {
  const wrap = el('div', className);
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = getWeatherIcon(code);
  return wrap;
}

export function renderWeatherView(container: HTMLElement, view: WeatherView): void {
  const { headline } = view;
  const temp = el('div', 'weather-temp', `${Math.round(headline.temp)}°`);
  const label =
    headline.kind === 'now'
      ? `Current temperature ${Math.round(headline.temp)} degrees`
      : `High on ${formatIsoDate(headline.date, { weekday: 'long', day: 'numeric', month: 'long' }, 'en-GB')}: ${Math.round(headline.temp)} degrees`;
  temp.setAttribute('role', 'img');
  temp.setAttribute('aria-label', label);

  const condition = el('div', 'weather-condition');
  condition.append(icon(headline.code, 'weather-icon-large'), el('span', '', getWeatherCondition(headline.code)));
  const current = el('div', 'weather-current');
  current.append(temp, condition);

  const caption = el('p', 'weather-caption weather-period', describePeriod(view.period));
  const parts: HTMLElement[] = [current, caption];
  if (headline.kind === 'high') {
    parts.splice(1, 0, el('p', 'weather-caption weather-headline-day', `High on ${formatIsoDate(headline.date, { weekday: 'short', day: 'numeric', month: 'short' }, 'en-GB')}`));
  }

  if (view.days.length > 0) {
    const list = el('div', 'weather-forecast');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', `${view.days.length}-day forecast`);
    for (const day of view.days) {
      const item = el('div', 'forecast-day');
      item.setAttribute('role', 'listitem');
      const temps = el('div', 'forecast-temp');
      temps.append(el('span', 'forecast-max', `${Math.round(day.max)}°`), el('span', 'forecast-min', `${Math.round(day.min)}°`));
      item.append(el('div', 'forecast-date', formatIsoDate(day.date, { weekday: 'short' })), icon(day.code, 'forecast-icon'), temps);
      list.appendChild(item);
    }
    parts.push(list);
  }

  container.replaceChildren(...parts);
  container.setAttribute('aria-busy', 'false');
}

function renderLoading(container: HTMLElement): void {
  const loader = el('div', 'loader');
  loader.setAttribute('role', 'status');
  loader.appendChild(el('span', 'sr-only', 'Loading weather...'));
  container.replaceChildren(loader);
  container.setAttribute('aria-busy', 'true');
}

function renderProblem(container: HTMLElement, onRetry: () => void): void {
  const message = el('p', 'widget-empty widget-error', 'Weather unavailable right now.');
  message.setAttribute('role', 'status');
  const retry = el('button', 'btn btn-secondary weather-retry', 'Try again');
  retry.type = 'button';
  retry.id = 'trip-weather-retry';
  retry.addEventListener('click', onRetry);
  container.replaceChildren(message, retry);
  container.setAttribute('aria-busy', 'false');
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export type WeatherState = 'loading' | 'ready' | 'problem' | 'hidden';

type FetchOutcome =
  | { ok: true; payload: unknown }
  | { ok: false; kind: 'unreachable' | 'bad-response' };

/** One request with a hard timeout. Never throws. */
export async function requestForecast(url: string, timeoutMs = WEATHER_TIMEOUT_MS): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, kind: 'bad-response' };
    try {
      return { ok: true, payload: (await res.json()) as unknown };
    } catch (err) {
      // The body stalled past the timeout (aborted) vs. a body that is not JSON.
      return { ok: false, kind: controller.signal.aborted || (err as Error)?.name === 'AbortError' ? 'unreachable' : 'bad-response' };
    }
  } catch {
    return { ok: false, kind: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

export interface TripWeatherInput {
  /** Destination coordinates as saved (numbers, numeric strings or null). */
  lat: number | string | null | undefined;
  lng: number | string | null | undefined;
  start: string | null | undefined;
  end: string | null | undefined;
}

export interface TripWeatherOptions {
  now?: Date;
  timeoutMs?: number;
  /** Start loading immediately instead of when the card scrolls near the viewport. */
  eager?: boolean;
}

/**
 * Fill the (static) weather section of trip.html for one destination and return a cleanup that
 * cancels everything in flight. Only called for a destination with coordinates; without them
 * the section stays hidden. Nothing here throws.
 */
export function mountTripWeather(section: HTMLElement, input: TripWeatherInput, options: TripWeatherOptions = {}): () => void {
  const container = section.querySelector<HTMLElement>('.widget-content');
  const coords = toCoords(input.lat ?? undefined, input.lng ?? undefined);
  const setState = (state: WeatherState): void => {
    section.dataset['state'] = state;
    section.hidden = state === 'hidden';
  };
  if (!container || !coords) {
    setState('hidden');
    return () => {};
  }

  const now = options.now ?? new Date();
  const today = toIsoDate(now);
  const period = pickForecastWindow(input.start, input.end, today);
  const [lat, lng] = coords;
  const key = cacheKeyFor(lat, lng, period);
  const url = buildForecastUrl(lat, lng, period);

  let cancelled = false;
  let observer: IntersectionObserver | null = null;
  let retryOnline = false;
  let started = false;

  const onOnline = (): void => { if (retryOnline) { retryOnline = false; void load(); } };
  globalThis.addEventListener?.('online', onOnline);

  const show = (view: WeatherView): void => {
    renderWeatherView(container, view);
    setState('ready');
  };

  async function load(): Promise<void> {
    if (cancelled) return;
    const cached = getCache<unknown>(key);
    if (cached !== null) {
      const view = parseForecast(cached, period, today);
      if (view) { show(view); return; }
      clearCache(key); // corrupted entry: drop it and refetch
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      retryOnline = true;
      setState('hidden');
      return;
    }

    setState('loading');
    renderLoading(container!);
    const outcome = await requestForecast(url, options.timeoutMs);
    if (cancelled) return;
    if (!outcome.ok && outcome.kind === 'unreachable') {
      retryOnline = true;
      setState('hidden');
      return;
    }
    const view = outcome.ok ? parseForecast(outcome.payload, period, today) : null;
    if (!view) {
      renderProblem(container!, () => { void load(); });
      setState('problem');
      return;
    }
    if (outcome.ok) setCache(key, outcome.payload);
    show(view);
  }

  if (options.eager || typeof IntersectionObserver === 'undefined') {
    void load();
  } else {
    // Hidden elements never intersect, so the card shows its loader and waits to be near the viewport.
    renderLoading(container);
    setState('loading');
    observer = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((e) => e.isIntersecting)) return;
        started = true;
        observer?.disconnect();
        observer = null;
        void load();
      },
      { rootMargin: '100px' },
    );
    observer.observe(section);
  }

  return () => {
    cancelled = true;
    observer?.disconnect();
    observer = null;
    globalThis.removeEventListener?.('online', onOnline);
  };
}
