import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/client', () => ({
  upsertHotel: vi.fn(),
  deleteHotel: vi.fn(),
  updateTrip: vi.fn(),
}));
vi.mock('@/modules/toast', () => ({ showToast: vi.fn() }));

import { renderHotelSection } from '@/pages/trip-edit/hotels';
import { initMetadataSection } from '@/pages/trip-edit/metadata';
import { upsertHotel, updateTrip } from '@/api/client';
import type { ApiDestination, ApiHotel, ApiTrip } from '@/types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Hotel modal — check-in/out order (BIZ-06), URL scheme, null coords, label
// ---------------------------------------------------------------------------

describe('hotel modal', () => {
  let container: HTMLElement;

  function render(hotel?: ApiHotel): void {
    document.getElementById('hotel-box')?.remove(); // modal singleton stays on <body>
    container = document.createElement('div');
    container.id = 'hotel-box';
    document.body.appendChild(container);
    const dest: ApiDestination = {
      id: '2', trip_id: '1', city_name: 'Kyoto', country: 'Japan', start_date: null, end_date: null,
      lat: 35, lng: 135, zoom_level: 12, order_index: 0, days: [], hotel,
    };
    renderHotelSection(container, dest, '1');
    const btn = Array.from(container.querySelectorAll('button')).find((b) => /Add hotel|Edit/.test(b.textContent ?? ''))!;
    btn.click();
  }
  async function submit(): Promise<void> {
    $('hotel-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
  }
  const errorText = () => ($('hotel-form-error').hasAttribute('hidden') ? null : $('hotel-form-error').textContent);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(upsertHotel).mockImplementation(async (_t, _d, data) => ({ id: 'h', ...data }) as ApiHotel);
  });

  it('labels the name field in English (BIZ-10)', () => {
    render();
    expect(document.querySelector('label[for="hotel-name"]')?.textContent).toBe('Name');
  });

  it('blocks check-out before check-in', async () => {
    render();
    $<HTMLInputElement>('hotel-name').value = 'Ryokan';
    $<HTMLInputElement>('hotel-check-in').value = '2026-03-05';
    $<HTMLInputElement>('hotel-check-out').value = '2026-03-04';
    await submit();
    expect(upsertHotel).not.toHaveBeenCalled();
    expect(errorText()).toBe('Check-out must be on or after Check-in.');
  });

  it.each([
    ['same day', '2026-03-05', '2026-03-05'],
    ['check-in only', '2026-03-05', ''],
    ['check-out only', '', '2026-03-05'],
  ])('allows %s', async (_l, inDate, outDate) => {
    render();
    $<HTMLInputElement>('hotel-name').value = 'Ryokan';
    $<HTMLInputElement>('hotel-check-in').value = inDate;
    $<HTMLInputElement>('hotel-check-out').value = outDate;
    await submit();
    expect(upsertHotel).toHaveBeenCalledWith(
      '1', '2',
      expect.objectContaining({ check_in_date: inDate || null, check_out_date: outDate || null }),
    );
  });

  it.each(['javascript:alert(1)', 'www.hotel.jp'])('rejects hotel URL %j before calling the API', async (url) => {
    render();
    $<HTMLInputElement>('hotel-name').value = 'Ryokan';
    $<HTMLInputElement>('hotel-url').value = url;
    await submit();
    expect(upsertHotel).not.toHaveBeenCalled();
    expect(errorText()).toMatch(/must start with http/);
  });

  it('edits a hotel without coordinates as empty, not "null"', () => {
    render({ id: 'h', name: 'H', lat: null, lng: null, check_in_date: null, check_out_date: null, url: null });
    expect($<HTMLInputElement>('hotel-lat').value).toBe('');
    expect($<HTMLInputElement>('hotel-lng').value).toBe('');
  });

  it('shows 422 messages from the API', async () => {
    vi.mocked(upsertHotel).mockRejectedValueOnce(
      Object.assign(new Error('x'), { status: 422, issues: [{ path: 'lat', message: 'lat must be between -90 and 90' }] }),
    );
    render();
    $<HTMLInputElement>('hotel-name').value = 'Ryokan';
    await submit();
    expect(errorText()).toBe('Please check the form: lat must be between -90 and 90.');
  });
});

// ---------------------------------------------------------------------------
// Trip metadata form — start/end order (BIZ-06)
// ---------------------------------------------------------------------------

describe('trip metadata form', () => {
  function init(start: string | null, end: string | null): void {
    document.body.innerHTML = `
      <h1 id="trip-name-heading"></h1>
      <section id="metadata-section" hidden>
        <form id="metadata-form">
          <input id="trip-name" name="name">
          <textarea id="trip-description" name="description"></textarea>
          <input type="date" id="trip-start-date" name="start_date">
          <input type="date" id="trip-end-date" name="end_date">
          <input type="checkbox" id="trip-public" name="is_public">
          <p id="metadata-error" hidden></p>
          <button type="submit" id="metadata-save-btn">Save changes</button>
        </form>
      </section>`;
    const trip: ApiTrip = {
      id: '1', user_id: '1', name: 'Japan', description: null, start_date: start, end_date: end,
      cover_image_url: null, is_public: false, public_slug: null, destinations: [],
    };
    initMetadataSection(trip);
  }
  async function submit(): Promise<void> {
    $('metadata-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
  }
  const errorText = () => ($('metadata-error').hasAttribute('hidden') ? null : $('metadata-error').textContent);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateTrip).mockResolvedValue({} as ApiTrip);
  });

  it('blocks end before start', async () => {
    init('2026-02-22', '2026-03-24');
    $<HTMLInputElement>('trip-end-date').value = '2026-02-21';
    await submit();
    expect(updateTrip).not.toHaveBeenCalled();
    expect(errorText()).toBe('End date must be on or after Start date.');
    expect($<HTMLButtonElement>('metadata-save-btn').disabled).toBe(false);
  });

  it('pre-links the pickers to the stored range', () => {
    init('2026-02-22', '2026-03-24');
    expect($<HTMLInputElement>('trip-end-date').min).toBe('2026-02-22');
    expect($<HTMLInputElement>('trip-start-date').max).toBe('2026-03-24');
  });

  it.each([
    ['partial (start only)', '2026-02-22', null],
    ['no dates', null, null],
    ['equal', '2026-02-22', '2026-02-22'],
  ])('saves a %s trip', async (_l, start, end) => {
    init(start, end);
    await submit();
    expect(updateTrip).toHaveBeenCalledWith('1', expect.objectContaining({ start_date: start, end_date: end }));
    expect(errorText()).toBeNull();
  });

  it('shows 422 messages from the API', async () => {
    vi.mocked(updateTrip).mockRejectedValueOnce(
      Object.assign(new Error('x'), { status: 422, issues: [{ path: '', message: 'Request body must include at least one field to update' }] }),
    );
    init(null, null);
    await submit();
    expect(errorText()).toBe('Please check the form: Request body must include at least one field to update.');
  });
});
