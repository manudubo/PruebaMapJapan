import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/client', () => ({
  createDestination: vi.fn(),
  updateDestination: vi.fn(),
  deleteDestination: vi.fn(),
  upsertHotel: vi.fn(),
  deleteHotel: vi.fn(),
  createDay: vi.fn(),
  updateDay: vi.fn(),
  deleteDay: vi.fn(),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
  reorderActivities: vi.fn(),
}));

import { initDestinationsSection } from '@/pages/trip-edit/destinations';
import { createDestination, updateDestination } from '@/api/client';
import { apiDestinationToCityData } from '@/modules/tripAdapter';
import type { ApiDestination, ApiTrip } from '@/types';

// Destination modal: zoom (BIZ-05), date order (BIZ-06), null coordinates.

function dest(overrides: Partial<ApiDestination> = {}): ApiDestination {
  return {
    id: '2', trip_id: '1', city_name: 'Kyoto', country: 'Japan',
    start_date: '2026-03-02', end_date: '2026-03-06', lat: '35.0116000', lng: '135.7681000',
    zoom_level: 13, order_index: 0, days: [], ...overrides,
  };
}

let trip: ApiTrip;
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function init(destinations: ApiDestination[] = []): void {
  // initDestinationsSection builds a fresh modal each call, so start from a
  // clean body every time to keep ids unique.
  document.body.innerHTML = `
    <button id="add-dest-btn">Add destination</button>
    <div id="destinations-list"></div>
    <p id="destinations-empty">none</p>`;
  trip = {
    id: '1', user_id: '1', name: 'T', description: null, start_date: null, end_date: null,
    cover_image_url: null, is_public: false, public_slug: null, destinations,
  };
  initDestinationsSection(trip, '1');
}

function openAdd(): void {
  $('add-dest-btn').click();
}
function openEdit(): void {
  Array.from(document.querySelectorAll<HTMLButtonElement>('.dest-section-header button'))
    .find((b) => b.textContent === 'Edit')!.click();
}
async function submit(): Promise<void> {
  $('dest-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
}
function errorText(): string | null {
  const el = $('dest-form-error');
  return el.hasAttribute('hidden') ? null : el.textContent;
}
function fill(city: string, start = '', end = ''): void {
  $<HTMLInputElement>('dest-city').value = city;
  $<HTMLInputElement>('dest-country').value = 'Japan';
  $<HTMLInputElement>('dest-start').value = start;
  $<HTMLInputElement>('dest-end').value = end;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createDestination).mockImplementation(async (_t, data) => ({ ...dest(), ...data, id: '9' }) as ApiDestination);
  vi.mocked(updateDestination).mockImplementation(async (_t, id, data) => ({ ...dest(), ...data, id }) as ApiDestination);
});

describe('zoom control (BIZ-05)', () => {
  it('is a labelled 1–19 slider with a live value', () => {
    init();
    openAdd();
    const zoom = $<HTMLInputElement>('dest-zoom');
    expect(zoom.type).toBe('range');
    expect([zoom.min, zoom.max, zoom.step]).toEqual(['1', '19', '1']);
    expect(document.querySelector('label[for="dest-zoom"]')?.textContent).toBe('Map zoom');
    expect(zoom.getAttribute('aria-describedby')).toBe('dest-zoom-hint');
    zoom.value = '15';
    zoom.dispatchEvent(new Event('input'));
    expect($<HTMLOutputElement>('dest-zoom-value').value).toBe('15');
  });

  it('new destination defaults to 12 and sends it', async () => {
    init();
    openAdd();
    expect($<HTMLInputElement>('dest-zoom').value).toBe('12');
    expect($<HTMLOutputElement>('dest-zoom-value').value).toBe('12');
    fill('Osaka');
    await submit();
    expect(createDestination).toHaveBeenCalledWith('1', expect.objectContaining({ zoom_level: 12 }));
  });

  it('sends the chosen zoom as a number', async () => {
    init();
    openAdd();
    fill('Naoshima');
    $<HTMLInputElement>('dest-zoom').value = '14';
    await submit();
    expect(createDestination).toHaveBeenCalledWith('1', expect.objectContaining({ zoom_level: 14 }));
  });

  it.each([
    [13, '13'],
    [null, '12'],
    [20, '19'], // API allows 20; the slider clamps to what the tiles support
    [1, '1'],
  ])('editing a destination with zoom_level %j shows %s', (zoom_level, shown) => {
    init([dest({ zoom_level })]);
    openEdit();
    expect($<HTMLInputElement>('dest-zoom').value).toBe(shown);
  });

  it('saved zoom reaches the map view via the adapter', async () => {
    init([dest()]);
    openEdit();
    $<HTMLInputElement>('dest-zoom').value = '16';
    await submit();
    expect(apiDestinationToCityData(trip.destinations[0]).zoom).toBe(16);
  });
});

describe('date order (BIZ-06)', () => {
  it('blocks departure before arrival without calling the API', async () => {
    init();
    openAdd();
    fill('Kyoto', '2026-03-06', '2026-03-02');
    await submit();
    expect(createDestination).not.toHaveBeenCalled();
    expect(errorText()).toBe('Departure must be on or after Arrival.');
    expect(document.activeElement?.id).toBe('dest-end');
  });

  it.each([
    ['equal dates', '2026-03-02', '2026-03-02'],
    ['arrival only', '2026-03-02', ''],
    ['departure only', '', '2026-03-06'],
    ['no dates', '', ''],
  ])('allows %s', async (_label, start, end) => {
    init();
    openAdd();
    fill('Kyoto', start, end);
    await submit();
    expect(createDestination).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ start_date: start || null, end_date: end || null }),
    );
    expect(errorText()).toBeNull();
  });

  it('links the pickers: departure min follows arrival and vice versa', () => {
    init();
    openAdd();
    const start = $<HTMLInputElement>('dest-start');
    const end = $<HTMLInputElement>('dest-end');
    start.value = '2026-03-02';
    start.dispatchEvent(new Event('input'));
    expect(end.min).toBe('2026-03-02');
    end.value = '2026-03-06';
    end.dispatchEvent(new Event('input'));
    expect(start.max).toBe('2026-03-06');
  });

  it('pickers reflect the stored range when editing, and reset for a new one', () => {
    init([dest()]);
    openEdit();
    expect($<HTMLInputElement>('dest-end').min).toBe('2026-03-02');
    expect($<HTMLInputElement>('dest-start').max).toBe('2026-03-06');
    Array.from(document.querySelectorAll<HTMLButtonElement>('#dest-cancel-btn'))[0].click();
    openAdd();
    expect($<HTMLInputElement>('dest-end').min).toBe('');
    expect($<HTMLInputElement>('dest-start').max).toBe('');
  });

  it('shows the API\'s message when the server rejects the dates (422)', async () => {
    vi.mocked(createDestination).mockRejectedValueOnce(
      Object.assign(new Error('Validation failed'), {
        status: 422,
        issues: [{ path: 'end_date', message: 'end_date must be on or after start_date' }],
      }),
    );
    init();
    openAdd();
    fill('Kyoto', '2026-03-02', '2026-03-06');
    await submit();
    expect(errorText()).toBe('Please check the form: end_date must be on or after start_date.');
  });
});

describe('coordinates', () => {
  it('a destination saved without coordinates edits as empty, not "null"', async () => {
    init([dest({ lat: null, lng: null })]);
    openEdit();
    expect($<HTMLInputElement>('dest-lat').value).toBe('');
    expect($<HTMLInputElement>('dest-lng').value).toBe('');
    await submit();
    const payload = vi.mocked(updateDestination).mock.calls[0][2];
    expect('lat' in payload).toBe(false);
    expect('lng' in payload).toBe(false);
  });

  it('stored NUMERIC strings are sent back as numbers', async () => {
    init([dest()]);
    openEdit();
    await submit();
    expect(updateDestination).toHaveBeenCalledWith('1', '2', expect.objectContaining({ lat: 35.0116, lng: 135.7681 }));
  });
});
