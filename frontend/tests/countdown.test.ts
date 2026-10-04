import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getCountdown, formatCountdown, initCountdown, msUntilNextMinute } from '@/modules/countdown';

// Landing demo countdown (QA-DEMO-FIXES finding 3): days / hours / minutes only, refreshed once a
// minute on the minute boundary. It replaces the inline per-second script in index.html.

const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): Date => new Date(y, mo - 1, d, h, mi, s, ms);
const START = local(2027, 2, 22);

describe('getCountdown', () => {
  it('splits the remaining time into days, hours and minutes', () => {
    expect(getCountdown(local(2027, 2, 20, 21, 30), START)).toEqual({ days: 1, hours: 2, minutes: 30 });
  });

  it('rounds partial minutes UP so it never shows 0 while time remains', () => {
    expect(getCountdown(local(2027, 2, 21, 23, 59, 0, 1), START)).toEqual({ days: 0, hours: 0, minutes: 1 });
    expect(getCountdown(local(2027, 2, 21, 23, 58, 30), START)).toEqual({ days: 0, hours: 0, minutes: 2 });
  });

  it('exact minute boundaries are exact', () => {
    expect(getCountdown(local(2027, 2, 21, 23, 59), START)).toEqual({ days: 0, hours: 0, minutes: 1 });
    expect(getCountdown(local(2027, 2, 21, 0, 0), START)).toEqual({ days: 1, hours: 0, minutes: 0 });
  });

  it('carries 60 minutes into the hour and 24 hours into the day', () => {
    expect(getCountdown(local(2027, 2, 21, 22, 59, 30), START)).toEqual({ days: 0, hours: 1, minutes: 1 });
    expect(getCountdown(local(2027, 2, 20, 23, 59, 59, 500), START)).toEqual({ days: 1, hours: 0, minutes: 1 });
    expect(getCountdown(local(2027, 2, 20, 0, 0, 0, 1), START)).toEqual({ days: 2, hours: 0, minutes: 0 });
  });

  it('returns null at and after the start (trip started / finished)', () => {
    expect(getCountdown(START, START)).toBeNull();
    expect(getCountdown(local(2027, 3, 30), START)).toBeNull();
  });

  it('counts calendar days across a DST change (wall-clock hours, not 24h blocks)', () => {
    // Whatever TZ the suite runs in (CI: UTC; also run with TZ=America/Argentina/Buenos_Aires
    // and TZ=Europe/Madrid), "same wall-clock time N days earlier" is N days.
    const start = local(2027, 4, 1);
    expect(getCountdown(local(2027, 3, 1), start)).toEqual({ days: 31, hours: 0, minutes: 0 });
    expect(getCountdown(local(2026, 10, 1, 12), local(2026, 11, 1))).toEqual({ days: 30, hours: 12, minutes: 0 });
  });
});

describe('formatCountdown', () => {
  it('pads hours and minutes, and builds a screen-reader sentence', () => {
    expect(formatCountdown({ days: 140, hours: 3, minutes: 7 })).toEqual({
      days: '140', hours: '03', minutes: '07',
      spoken: '140 days, 3 hours and 7 minutes until the trip',
    });
    expect(formatCountdown({ days: 1, hours: 1, minutes: 1 }).spoken).toBe('1 day, 1 hour and 1 minute until the trip');
  });
});

describe('msUntilNextMinute', () => {
  it('aligns to the next minute boundary', () => {
    expect(msUntilNextMinute(local(2027, 1, 1, 10, 0, 59, 900).getTime())).toBe(100);
    expect(msUntilNextMinute(local(2027, 1, 1, 10, 0, 0, 0).getTime())).toBe(60_000);
  });
});

// ---------------------------------------------------------------------------
// DOM behaviour
// ---------------------------------------------------------------------------

function mount(start = '2027-02-22'): HTMLElement {
  document.body.innerHTML = `
    <div id="demo-countdown-wrap" data-trip-start="${start}">
      <div id="demo-countdown">
        <span id="cd-sr"></span>
        <span id="cd-days">--</span><span id="cd-hours">--</span><span id="cd-mins">--</span>
      </div>
    </div>`;
  return document.getElementById('demo-countdown-wrap')!;
}

const text = (id: string): string | null => document.getElementById(id)!.textContent;

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('initCountdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
    document.body.innerHTML = '';
  });

  it('renders immediately and only days/hours/minutes (no seconds element is required)', () => {
    vi.setSystemTime(local(2027, 2, 20, 21, 30, 15));
    mount();
    initCountdown();
    expect([text('cd-days'), text('cd-hours'), text('cd-mins')]).toEqual(['1', '02', '30']);
    expect(text('cd-sr')).toBe('1 day, 2 hours and 30 minutes until the trip');
  });

  it('parses the start as a LOCAL calendar date (not UTC midnight)', () => {
    vi.setSystemTime(local(2027, 2, 21, 0, 0));
    mount();
    initCountdown();
    expect([text('cd-days'), text('cd-hours'), text('cd-mins')]).toEqual(['1', '00', '00']);
  });

  it('updates on the minute boundary and then once a minute, never per second', () => {
    vi.setSystemTime(local(2027, 2, 20, 21, 30, 15));
    mount();
    initCountdown();

    vi.advanceTimersByTime(44_000); // 21:30:59 - still the same minute
    expect(text('cd-mins')).toBe('30');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1_000); // 21:31:00
    expect(text('cd-mins')).toBe('29');
    vi.advanceTimersByTime(59_999);
    expect(text('cd-mins')).toBe('29');
    vi.advanceTimersByTime(1);
    expect(text('cd-mins')).toBe('28');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('hides the block when the trip has already started (existing behaviour)', () => {
    vi.setSystemTime(local(2027, 3, 1));
    const wrap = mount();
    initCountdown();
    expect(wrap.hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hides the block when the countdown reaches zero while the page is open', () => {
    vi.setSystemTime(local(2027, 2, 21, 23, 58, 30));
    const wrap = mount();
    initCountdown();
    expect(text('cd-mins')).toBe('02');
    vi.advanceTimersByTime(30_000);
    expect(text('cd-mins')).toBe('01');
    vi.advanceTimersByTime(60_000);
    expect(wrap.hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hides the block for a missing or invalid start date', () => {
    vi.setSystemTime(local(2027, 1, 1));
    const wrap = mount('2027-02-30');
    initCountdown();
    expect(wrap.hidden).toBe(true);
  });

  it('stops while the tab is hidden and catches up immediately when visible again', () => {
    vi.setSystemTime(local(2027, 2, 20, 21, 30, 0));
    mount();
    initCountdown();
    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(local(2027, 2, 21, 9, 0, 20)); // laptop slept / tab in background
    setHidden(false);
    expect([text('cd-days'), text('cd-hours'), text('cd-mins')]).toEqual(['0', '15', '00']);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('returns a cleanup that clears its timer and listener', () => {
    vi.setSystemTime(local(2027, 2, 20, 21, 30, 0));
    mount();
    const stop = initCountdown();
    stop();
    expect(vi.getTimerCount()).toBe(0);
    setHidden(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is a no-op on pages without the countdown', () => {
    document.body.innerHTML = '<main></main>';
    expect(() => initCountdown()()).not.toThrow();
  });
});

describe('landing markup', () => {
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');

  it('has days/hours/minutes and no seconds', () => {
    expect(doc.getElementById('cd-days')).not.toBeNull();
    expect(doc.getElementById('cd-hours')).not.toBeNull();
    expect(doc.getElementById('cd-mins')).not.toBeNull();
    expect(doc.getElementById('cd-secs')).toBeNull();
    expect(html).not.toMatch(/seconds/i);
  });

  it('the inline per-second script is gone (the module owns the countdown)', () => {
    expect(html).not.toMatch(/setInterval\(update,\s*1000\)/);
    expect(html).not.toContain('Demo countdown');
  });

  it('is a polite-free timer: no live region that would announce every update', () => {
    const timer = doc.getElementById('demo-countdown')!;
    expect(timer.getAttribute('role')).toBe('timer');
    expect(timer.getAttribute('aria-live')).toBe('off');
    for (const unit of timer.querySelectorAll('.countdown-unit')) expect(unit.getAttribute('aria-hidden')).toBe('true');
    expect(doc.getElementById('cd-sr')!.classList.contains('sr-only')).toBe(true);
  });
});
