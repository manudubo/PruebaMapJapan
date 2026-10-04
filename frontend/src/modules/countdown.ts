import { parseLocalDate, toIsoDate, daysBetween } from './dates';

/**
 * Landing demo countdown: days / hours / minutes until the demo trip starts.
 *
 * - The start date lives in the markup (`data-trip-start="YYYY-MM-DD"`) and is a
 *   calendar date, parsed as LOCAL midnight (dates.ts), like every trip date.
 * - Days are calendar days (wall clock), so a DST change never shows "23 hours".
 * - Partial minutes round UP: the display never reads 0 while time remains,
 *   and reaches zero exactly at the start, when the block is hidden.
 * - One update per minute, aligned to the minute boundary (setTimeout chain, no
 *   drift); paused while the tab is hidden and refreshed when it is shown again.
 *
 * Replaces an inline per-second script in index.html and the old `#countdown`
 * page section, which no page renders any more.
 */

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
}

const MINUTE = 60_000;

/** Time left until `start`, or null when the trip has started (or ended). */
export function getCountdown(now: Date | number, start: Date): CountdownParts | null {
  const nowDate = new Date(now);
  if (nowDate.getTime() >= start.getTime()) return null;

  let days = daysBetween(toIsoDate(nowDate), toIsoDate(start)) ?? 0;
  const shifted = new Date(nowDate);
  shifted.setDate(nowDate.getDate() + days);
  if (shifted.getTime() > start.getTime()) {
    days -= 1;
    shifted.setTime(nowDate.getTime());
    shifted.setDate(nowDate.getDate() + days);
  }

  const totalMinutes = Math.ceil((start.getTime() - shifted.getTime()) / MINUTE);
  let hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  days += Math.floor(hours / 24);
  hours %= 24;
  return { days, hours, minutes };
}

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

export function formatCountdown({ days, hours, minutes }: CountdownParts): {
  days: string; hours: string; minutes: string; spoken: string;
} {
  return {
    days: String(days),
    hours: String(hours).padStart(2, '0'),
    minutes: String(minutes).padStart(2, '0'),
    spoken: `${plural(days, 'day')}, ${plural(hours, 'hour')} and ${plural(minutes, 'minute')} until the trip`,
  };
}

/** Milliseconds until the next whole minute (a full minute when exactly on one). */
export function msUntilNextMinute(nowMs: number): number {
  return MINUTE - (((nowMs % MINUTE) + MINUTE) % MINUTE);
}

/**
 * Start the landing countdown. Returns a cleanup function (also a no-op on
 * pages without the countdown).
 */
export function initCountdown(): () => void {
  const wrap = document.getElementById('demo-countdown-wrap');
  if (!wrap) return () => {};
  const start = parseLocalDate(wrap.dataset.tripStart);
  const el = {
    days: document.getElementById('cd-days'),
    hours: document.getElementById('cd-hours'),
    minutes: document.getElementById('cd-mins'),
    spoken: document.getElementById('cd-sr'),
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const stop = (): void => {
    clear();
    document.removeEventListener('visibilitychange', onVisibility);
  };

  function tick(): void {
    clear();
    if (!wrap!.isConnected) return stop();
    const parts = start ? getCountdown(Date.now(), start) : null;
    if (!parts) {
      wrap!.hidden = true;
      return stop();
    }
    const text = formatCountdown(parts);
    if (el.days) el.days.textContent = text.days;
    if (el.hours) el.hours.textContent = text.hours;
    if (el.minutes) el.minutes.textContent = text.minutes;
    if (el.spoken) el.spoken.textContent = text.spoken;
    if (document.visibilityState !== 'hidden') timer = setTimeout(tick, msUntilNextMinute(Date.now()));
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') clear();
    else tick();
  }

  document.addEventListener('visibilitychange', onVisibility);
  tick();
  return stop;
}
