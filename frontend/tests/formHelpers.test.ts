import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/auth/keycloak', () => ({
  getToken: vi.fn().mockResolvedValue('mock-token'),
  isAuthenticated: vi.fn().mockReturnValue(true),
  login: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/modules/toast', () => ({ showToast: vi.fn() }));

import {
  saveErrorMessage,
  dateOrderError,
  isHttpUrl,
  linkDateBounds,
  buildCheckbox,
  GENERIC_SAVE_ERROR,
} from '@/pages/trip-edit/formHelpers';
import { ApiError, updateActivity } from '@/api/client';

describe('saveErrorMessage', () => {
  it('lists every 422 issue', () => {
    const err = new ApiError(422, 'validation_error', 'Validation failed', [
      { path: 'lat', message: 'lat must be between -90 and 90' },
      { path: 'time', message: 'time must be HH:MM (24-hour)' },
    ]);
    expect(saveErrorMessage(err)).toBe(
      'Please check the form: lat must be between -90 and 90; time must be HH:MM (24-hour).',
    );
  });

  it.each([
    ['422 without issues', new ApiError(422, 'validation_error')],
    ['422 with junk issues', Object.assign(new Error(), { status: 422, issues: [null, { path: 'x' }, 5] })],
    ['422 with non-array issues', Object.assign(new Error(), { status: 422, issues: 'nope' })],
  ])('%s → generic invalid-form message', (_l, err) => {
    expect(saveErrorMessage(err)).toBe('Some fields are invalid. Please check the form.');
  });

  it.each([
    ['network error', new TypeError('Failed to fetch')],
    ['500', new ApiError(500, 'internal_error')],
    ['404', new ApiError(404, 'unknown')],
    ['null', null],
    ['undefined', undefined],
    ['string', 'boom'],
    ['422 as a string status', { status: '422' }],
  ])('%s → connection message', (_l, err) => {
    expect(saveErrorMessage(err)).toBe(GENERIC_SAVE_ERROR);
  });
});

describe('dateOrderError', () => {
  it.each([
    ['2026-02-22', '2026-02-23', null],
    ['2026-02-22', '2026-02-22', null],
    ['', '2026-02-22', null],
    ['2026-02-22', '', null],
    ['', '', null],
    ['2026-02-23', '2026-02-22', 'End must be on or after Start.'],
    ['2027-01-01', '2026-12-31', 'End must be on or after Start.'],
  ])('%j → %j is %j', (start, end, expected) => {
    expect(dateOrderError(start, end, 'Start', 'End')).toBe(expected);
  });
});

describe('isHttpUrl', () => {
  it.each(['https://maps.app.goo.gl/x', 'http://a.b', 'HTTPS://A.B'])('%s → true', (u) => {
    expect(isHttpUrl(u)).toBe(true);
  });
  it.each(['javascript:alert(1)', 'data:,x', 'ftp://a.b', 'a.b', '', ' '])('%j → false', (u) => {
    expect(isHttpUrl(u)).toBe(false);
  });
});

describe('linkDateBounds', () => {
  it('sets min/max from current values and follows edits; clearing removes the bound', () => {
    const start = document.createElement('input');
    const end = document.createElement('input');
    start.type = end.type = 'date';
    start.value = '2026-02-22';
    linkDateBounds(start, end);
    expect(end.min).toBe('2026-02-22');
    start.value = '';
    start.dispatchEvent(new Event('input'));
    expect(end.min).toBe('');
  });
});

describe('buildCheckbox', () => {
  it('wraps the input in its label and links the hint', () => {
    const { group, input } = buildCheckbox('x-id', 'x_name', 'Label text', 'Hint text');
    expect(input.type).toBe('checkbox');
    expect(input.closest('label')?.textContent).toBe('Label text');
    expect(input.getAttribute('aria-describedby')).toBe('x-id-hint');
    expect(group.querySelector('#x-id-hint')?.textContent).toBe('Hint text');
  });

  it('omits the hint when none is given', () => {
    const { group, input } = buildCheckbox('y', 'y', 'L');
    expect(group.querySelector('.form-hint')).toBeNull();
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('API client carries 422 issues to the form', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ApiError has status, code, error message and issues from the body', async () => {
    const body = {
      success: false,
      error: 'Validation failed',
      code: 'validation_error',
      issues: [{ path: 'maps_url', message: 'URL must start with http:// or https://' }],
    };
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 422 }));
    const err = await updateActivity('1', '2', '3', '4', { maps_url: 'javascript:x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'validation_error', message: 'Validation failed', issues: body.issues });
    expect(saveErrorMessage(err)).toBe('Please check the form: URL must start with http:// or https://.');
  });

  it('non-JSON error bodies still produce an ApiError with no issues', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    const err = await updateActivity('1', '2', '3', '4', { name: 'x' }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: 'unknown', issues: [] });
    expect(saveErrorMessage(err)).toBe(GENERIC_SAVE_ERROR);
  });
});
