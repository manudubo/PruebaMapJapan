import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/api/client', () => ({
  createDay: vi.fn(),
  updateDay: vi.fn(),
  deleteDay: vi.fn(),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
  reorderActivities: vi.fn(),
}));

import { renderDaysSection } from '@/pages/trip-edit/days';
import { createDay } from '@/api/client';
import type { ApiDay, ApiDestination } from '@/types';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

function makeDest(start: string | null, end: string | null, existing: string[] = []): ApiDestination {
  return {
    id: '2', trip_id: '1', city_name: 'Tokyo', country: 'Japan',
    start_date: start, end_date: end, lat: 35, lng: 139, zoom_level: 12, order_index: 0,
    days: existing.map((date, i) => ({
      id: `e${i}`, date, label: '', color_hex: '#ff3b30', order_index: i, activities: [],
    })),
  };
}

async function clickGenerate(dest: ApiDestination): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  renderDaysSection(container, dest, '1');
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Generate all days')!;
  btn.click();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return container;
}

function postedDates(): string[] {
  return vi.mocked(createDay).mock.calls.map((call) => (call[2] as { date: string }).date);
}

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  vi.mocked(createDay).mockImplementation(async (_t, _d, data) => ({
    id: `new${n++}`, date: (data as { date: string }).date, label: '', color_hex: '#ff3b30',
    order_index: 0, activities: [],
  }) as ApiDay);
});

describe('Generate all days (BIZ-11)', () => {
  it.each([
    'America/New_York',
    'America/Argentina/Buenos_Aires',
    'America/Santiago',
    'Pacific/Auckland',
    'Pacific/Kiritimati',
    'Etc/GMT+12',
    'UTC',
  ])('posts each date exactly once across the US DST change in %s', async (tz) => {
    process.env.TZ = tz;
    // The old new Date(iso)/setDate/toISOString loop posted 2026-03-08 twice
    // and dropped 2026-03-10 in America/New_York.
    await clickGenerate(makeDest('2026-03-06', '2026-03-10'));
    expect(postedDates()).toEqual(['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
  });

  it('posts a single day when arrival equals departure', async () => {
    await clickGenerate(makeDest('2026-02-22', '2026-02-22'));
    expect(postedDates()).toEqual(['2026-02-22']);
  });

  it('skips dates that already exist', async () => {
    await clickGenerate(makeDest('2026-02-22', '2026-02-25', ['2026-02-23', '2026-02-25']));
    expect(postedDates()).toEqual(['2026-02-22', '2026-02-24']);
  });

  it('explains instead of posting when departure is before arrival', async () => {
    const container = await clickGenerate(makeDest('2026-02-25', '2026-02-22'));
    expect(createDay).not.toHaveBeenCalled();
    expect(container.querySelector('.error-msg')?.textContent).toMatch(/departure is before its arrival/);
  });

  it('refuses to fire hundreds of requests for a typo\'d year', async () => {
    const container = await clickGenerate(makeDest('2026-02-22', '2027-02-22'));
    expect(createDay).not.toHaveBeenCalled();
    expect(container.querySelector('.error-msg')?.textContent).toMatch(/more than 120 days/);
  });

  it.each([
    ['no dates', null, null],
    ['only arrival', '2026-02-22', null],
    ['only departure', null, '2026-02-22'],
  ])('asks for dates when the destination has %s', async (_label, start, end) => {
    const container = await clickGenerate(makeDest(start, end));
    expect(createDay).not.toHaveBeenCalled();
    expect(container.querySelector('.error-msg')?.textContent).toMatch(/no dates defined/);
  });

  it('reports when every day already exists', async () => {
    const container = await clickGenerate(makeDest('2026-02-22', '2026-02-23', ['2026-02-22', '2026-02-23']));
    expect(createDay).not.toHaveBeenCalled();
    expect(container.querySelector('.error-msg')?.textContent).toMatch(/already exist/);
  });
});

// BIZ-07: the API rejects a day outside the destination's (server-side)
// dates with 422 date_conflict. The editor must say why, and keep the days
// that were created.
function dateConflict(date: string) {
  const message = `The day date (${date}) must be within the destination dates (2026-03-06 to 2026-03-08).`;
  return Object.assign(new Error(message), {
    status: 422,
    code: 'date_conflict',
    issues: [{ path: 'date', message }],
  });
}

describe('Generate all days — server rejections (BIZ-07)', () => {
  it('keeps the created days and shows the API message for the rejected ones', async () => {
    vi.mocked(createDay).mockImplementation(async (_t, _d, data) => {
      const { date } = data as { date: string };
      if (date > '2026-03-08') throw dateConflict(date);
      return { id: `n-${date}`, date, label: '', color_hex: null, order_index: 0, activities: [] } as ApiDay;
    });
    const dest = makeDest('2026-03-06', '2026-03-10'); // stale copy: server says 03-06..03-08
    const container = await clickGenerate(dest);

    expect(dest.days.map((d) => d.date).sort()).toEqual(['2026-03-06', '2026-03-07', '2026-03-08']);
    expect(container.querySelectorAll('.day-row')).toHaveLength(3);
    const err = container.querySelector<HTMLElement>('[data-role="generate-error"]')!;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain('Could not generate 2 of 5 days.');
    expect(err.textContent).toContain('must be within the destination dates (2026-03-06 to 2026-03-08)');
  });

  it('when every request is rejected, nothing is added and the 422 reason is shown', async () => {
    vi.mocked(createDay).mockImplementation(async (_t, _d, data) => {
      throw dateConflict((data as { date: string }).date);
    });
    const dest = makeDest('2026-03-06', '2026-03-07');
    const container = await clickGenerate(dest);
    expect(dest.days).toHaveLength(0);
    const err = container.querySelector<HTMLElement>('[data-role="generate-error"]')!;
    expect(err.textContent).toMatch(/^Could not generate 2 of 2 days\. Please check the form: The day date/);
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Generate all days')!;
    expect(btn.disabled).toBe(false);
  });

  it('a network failure keeps the generic retry message (no API text to show)', async () => {
    vi.mocked(createDay).mockRejectedValue(new TypeError('Failed to fetch'));
    const container = await clickGenerate(makeDest('2026-03-06', '2026-03-06'));
    expect(container.querySelector('[data-role="generate-error"]')?.textContent).toBe(
      'Could not generate 1 of 1 days. Please try again.',
    );
  });
});

describe('Day modal — server rejections (BIZ-07)', () => {
  async function submitDay(date: string): Promise<HTMLElement> {
    // The day modal is a module singleton appended to <body> once: keep it.
    document.querySelectorAll('[data-test="days-host"]').forEach((el) => el.remove());
    const container = document.createElement('div');
    container.dataset['test'] = 'days-host';
    document.body.appendChild(container);
    renderDaysSection(container, makeDest('2026-03-06', '2026-03-08'), '1');
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Add day')!.click();
    (document.getElementById('day-date') as HTMLInputElement).value = date;
    (document.getElementById('day-form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    return document.getElementById('day-form-error')!;
  }

  it('shows the API explanation for a 422 date_conflict instead of "check your connection"', async () => {
    vi.mocked(createDay).mockRejectedValue(dateConflict('2026-03-12'));
    const err = await submitDay('2026-03-12');
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain('2026-03-12');
    expect(err.textContent).toContain('2026-03-06 to 2026-03-08');
    expect(err.textContent).not.toMatch(/connection/);
  });

  it('still blames the connection for a network error', async () => {
    vi.mocked(createDay).mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await submitDay('2026-03-07');
    expect(err.textContent).toMatch(/Check your connection/);
  });
});
