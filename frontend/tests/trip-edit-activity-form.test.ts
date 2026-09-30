import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/client', () => ({
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
  reorderActivities: vi.fn(),
}));
vi.mock('@/modules/geocoder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/geocoder')>();
  return { ...actual, searchNominatim: vi.fn() };
});

import { renderActivitiesSection } from '@/pages/trip-edit/activities';
import { createActivity, updateActivity } from '@/api/client';
import { apiDayToDay } from '@/modules/tripAdapter';
import type { ApiActivity, ApiDay } from '@/types';

// Editor → API payload for the activity modal (BIZ-01/02/03/04).

function act(overrides: Partial<ApiActivity> = {}): ApiActivity {
  return {
    id: '1',
    name: 'Senso-ji',
    lat: '35.7148000',
    lng: '139.7967000',
    notes: null,
    is_optional: false,
    is_generic: false,
    maps_url: null,
    order_index: 0,
    time: null,
    ...overrides,
  };
}

let day: ApiDay;
let container: HTMLElement;

function render(activities: ApiActivity[] = []): void {
  // The modal is a module singleton appended to <body> once — only replace
  // the list container, never the whole body.
  document.getElementById('acts')?.remove();
  container = document.createElement('div');
  container.id = 'acts';
  document.body.appendChild(container);
  day = { id: '7', date: '2026-02-22', label: 'Day 1', color_hex: '#000000', order_index: 0, activities };
  renderActivitiesSection(container, day, '1', '2');
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function openAdd(): void {
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Add activity')!.click();
}
function openEdit(index = 0): void {
  Array.from(container.querySelectorAll('button')).filter((b) => b.textContent === 'Edit')[index].click();
}
async function submit(): Promise<void> {
  $('act-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
}
function errorText(): string | null {
  const el = $('act-form-error');
  return el.hasAttribute('hidden') ? null : el.textContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createActivity).mockImplementation(async (_t, _d, _day, data) => ({ ...act(), ...data, id: '99' }) as ApiActivity);
  vi.mocked(updateActivity).mockImplementation(async (_t, _d, _day, id, data) => ({ ...act(), ...data, id }) as ApiActivity);
});

describe('activity modal fields', () => {
  it('has labelled controls for optional, generic and maps link', () => {
    render();
    openAdd();
    expect(document.querySelector('label[for="act-maps-url"]')?.textContent).toBe('Google Maps link (optional)');
    expect($<HTMLInputElement>('act-maps-url').type).toBe('url');
    expect($<HTMLInputElement>('act-optional').closest('label')?.textContent).toBe('Alternative option');
    expect($<HTMLInputElement>('act-generic').closest('label')?.textContent).toBe('General area, not an exact spot');
    expect($<HTMLInputElement>('act-optional').getAttribute('aria-describedby')).toBe('act-optional-hint');
    expect($('act-optional-hint').textContent).toMatch(/Option A, B/);
  });

  it('new activity starts with every flag off and empty link', () => {
    render();
    openAdd();
    expect($<HTMLInputElement>('act-optional').checked).toBe(false);
    expect($<HTMLInputElement>('act-generic').checked).toBe(false);
    expect($<HTMLInputElement>('act-maps-url').value).toBe('');
  });
});

describe('create → payload (BIZ-01..04)', () => {
  it('sends optional + generic + time + maps_url together', async () => {
    render();
    openAdd();
    $<HTMLInputElement>('act-name').value = '  Arashiyama area  ';
    $<HTMLInputElement>('act-time').value = '08:00';
    $<HTMLTextAreaElement>('act-notes').value = 'Bamboo grove';
    $<HTMLInputElement>('act-maps-url').value = ' https://maps.app.goo.gl/abc ';
    $<HTMLInputElement>('act-optional').checked = true;
    $<HTMLInputElement>('act-generic').checked = true;
    await submit();
    expect(createActivity).toHaveBeenCalledWith('1', '2', '7', {
      name: 'Arashiyama area',
      time: '08:00',
      notes: 'Bamboo grove',
      maps_url: 'https://maps.app.goo.gl/abc',
      is_optional: true,
      is_generic: true,
    });
    expect(errorText()).toBeNull();
  });

  it('sends explicit false / null for untouched fields', async () => {
    render();
    openAdd();
    $<HTMLInputElement>('act-name').value = 'Plain';
    await submit();
    expect(createActivity).toHaveBeenCalledWith('1', '2', '7', {
      name: 'Plain',
      time: null,
      notes: null,
      maps_url: null,
      is_optional: false,
      is_generic: false,
    });
  });

  it('shows the new activity with its Option / Area tags', async () => {
    render();
    openAdd();
    $<HTMLInputElement>('act-name').value = 'Area pick';
    $<HTMLInputElement>('act-optional').checked = true;
    $<HTMLInputElement>('act-generic').checked = true;
    await submit();
    const tags = Array.from(container.querySelectorAll('.activity-tag')).map((t) => t.textContent);
    expect(tags).toEqual(['Option', 'Area']);
  });
});

describe('edit → payload', () => {
  it('pre-fills flags, link and time from the stored activity', () => {
    render([act({ is_optional: true, is_generic: true, maps_url: 'https://x.test/m', time: '09:30' })]);
    openEdit();
    expect($<HTMLInputElement>('act-optional').checked).toBe(true);
    expect($<HTMLInputElement>('act-generic').checked).toBe(true);
    expect($<HTMLInputElement>('act-maps-url').value).toBe('https://x.test/m');
    expect($<HTMLInputElement>('act-time').value).toBe('09:30');
  });

  it('does not leak the previous activity\'s flags into the next one', () => {
    render([act({ is_optional: true, is_generic: true, maps_url: 'https://x.test/m' }), act({ id: '2', name: 'Other', order_index: 1 })]);
    openEdit(0);
    openEdit(1);
    expect($<HTMLInputElement>('act-optional').checked).toBe(false);
    expect($<HTMLInputElement>('act-generic').checked).toBe(false);
    expect($<HTMLInputElement>('act-maps-url').value).toBe('');
  });

  it('can turn flags off and clear time and link', async () => {
    render([act({ is_optional: true, is_generic: true, maps_url: 'https://x.test/m', time: '09:30' })]);
    openEdit();
    $<HTMLInputElement>('act-optional').checked = false;
    $<HTMLInputElement>('act-generic').checked = false;
    $<HTMLInputElement>('act-maps-url').value = '   ';
    $<HTMLInputElement>('act-time').value = '';
    await submit();
    expect(updateActivity).toHaveBeenCalledWith(
      '1', '2', '7', '1',
      expect.objectContaining({ is_optional: false, is_generic: false, maps_url: null, time: null }),
    );
  });

  it('keeps stored NUMERIC-string coordinates as numbers in the payload', async () => {
    render([act()]);
    openEdit();
    await submit();
    expect(updateActivity).toHaveBeenCalledWith('1', '2', '7', '1', expect.objectContaining({ lat: 35.7148, lng: 139.7967 }));
  });

  it('does not send lat/lng for an activity without coordinates', async () => {
    render([act({ lat: null, lng: null })]);
    openEdit();
    await submit();
    const payload = vi.mocked(updateActivity).mock.calls[0][4];
    expect('lat' in payload).toBe(false);
    expect('lng' in payload).toBe(false);
  });
});

describe('client-side guards and server errors', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'maps.google.com/?q=x',
    'ftp://example.com',
  ])('rejects maps link %j before calling the API', async (url) => {
    render();
    openAdd();
    $<HTMLInputElement>('act-name').value = 'X';
    $<HTMLInputElement>('act-maps-url').value = url;
    await submit();
    expect(createActivity).not.toHaveBeenCalled();
    expect(errorText()).toMatch(/must start with http/);
  });

  it('shows field messages from a 422', async () => {
    vi.mocked(createActivity).mockRejectedValueOnce(
      Object.assign(new Error('Validation failed'), {
        status: 422,
        issues: [{ path: 'time', message: 'time must be HH:MM (24-hour)' }],
      }),
    );
    render();
    openAdd();
    $<HTMLInputElement>('act-name').value = 'X';
    await submit();
    expect(errorText()).toBe('Please check the form: time must be HH:MM (24-hour).');
  });

  it('keeps the connection message for other failures', async () => {
    vi.mocked(createActivity).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render();
    openAdd();
    $<HTMLInputElement>('act-name').value = 'X';
    await submit();
    expect(errorText()).toBe('Could not save. Check your connection and try again.');
  });

  it('re-enables Save after a failure', async () => {
    vi.mocked(createActivity).mockRejectedValueOnce(new Error('boom'));
    render();
    openAdd();
    $<HTMLInputElement>('act-name').value = 'X';
    await submit();
    expect($<HTMLButtonElement>('act-save-btn').disabled).toBe(false);
    expect($('act-save-btn').textContent).toBe('Save');
  });
});

describe('Google Maps URL paste', () => {
  const pasted = 'https://www.google.com/maps/place/Senso-ji/@35.7147651,139.7966553,17z';

  it('fills coordinates and the maps link when the link is empty', async () => {
    render();
    openAdd();
    $<HTMLInputElement>('act-geocoder-input').value = pasted;
    $<HTMLButtonElement>('act-geocoder-btn').click();
    await new Promise((r) => setTimeout(r, 0));
    expect($<HTMLInputElement>('act-lat').value).toBe('35.7147651');
    expect($<HTMLInputElement>('act-maps-url').value).toBe(pasted);
  });

  it('does not overwrite a link the user already typed', async () => {
    render();
    openAdd();
    $<HTMLInputElement>('act-maps-url').value = 'https://maps.app.goo.gl/mine';
    $<HTMLInputElement>('act-geocoder-input').value = pasted;
    $<HTMLButtonElement>('act-geocoder-btn').click();
    await new Promise((r) => setTimeout(r, 0));
    expect($<HTMLInputElement>('act-maps-url').value).toBe('https://maps.app.goo.gl/mine');
  });
});

describe('form → payload → view (round trip through the adapter)', () => {
  it('what the editor saves is what the trip view shows', async () => {
    render();
    openAdd();
    $<HTMLInputElement>('act-name').value = 'Arashiyama area';
    $<HTMLInputElement>('act-time').value = '08:00';
    $<HTMLInputElement>('act-maps-url').value = 'https://maps.app.goo.gl/abc';
    $<HTMLInputElement>('act-optional').checked = true;
    $<HTMLInputElement>('act-generic').checked = true;
    await submit();
    // The mocked API echoes the payload back like the real one (plus DB
    // defaults), and the editor keeps it in day.activities.
    const viewDay = apiDayToDay(day);
    expect(viewDay.activities[0]).toMatchObject({
      name: 'Arashiyama area',
      time: '08:00',
      mapsUrl: 'https://maps.app.goo.gl/abc',
      optional: 'A',
      isGeneric: true,
    });
    expect(viewDay.hasOptions).toBe(true);
  });
});
