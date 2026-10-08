import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_PAGES,
  DEMO_PAGES,
  currentTripIdFromLocation,
  pageKindFromPath,
  pageNameFromPath,
  resolveSearchScope,
  scopeFallback,
  scopeLabels,
} from '@/modules/searchScope';
import type { AuthStatus } from '@/auth/keycloak';

const AUTH: AuthStatus[] = ['pending', 'authenticated', 'anonymous', 'unavailable'];

describe('pageNameFromPath', () => {
  it.each([
    ['/', 'index.html'],
    ['', 'index.html'],
    ['/PruebaMapJapan/', 'index.html'],
    ['/PruebaMapJapan/index.html', 'index.html'],
    ['/PruebaMapJapan/Dashboard.HTML', 'dashboard.html'],
    ['/trip.html', 'trip.html'],
    ['/a/b/c/kyoto.html', 'kyoto.html'],
  ])('%s -> %s', (path, name) => {
    expect(pageNameFromPath(path)).toBe(name);
  });
});

describe('pageKindFromPath', () => {
  it('every static city page and the landing are demo pages', () => {
    for (const p of DEMO_PAGES) expect(pageKindFromPath(`/PruebaMapJapan/${p}`)).toBe('demo');
    expect(DEMO_PAGES.size).toBe(9);
  });

  it('dashboard, trip view, trip editor and profile are account pages', () => {
    for (const p of ACCOUNT_PAGES) expect(pageKindFromPath(`/PruebaMapJapan/${p}`)).toBe('account');
    expect([...ACCOUNT_PAGES].sort()).toEqual(['dashboard.html', 'profile.html', 'trip-edit.html', 'trip.html']);
  });

  it('anything else (account recovery, unknown paths) is "other"', () => {
    expect(pageKindFromPath('/PruebaMapJapan/recover.html')).toBe('other');
    expect(pageKindFromPath('/PruebaMapJapan/nope.html')).toBe('other');
    expect(pageKindFromPath('/trip.html.bak')).toBe('other');
  });

  it('demo and account sets do not overlap', () => {
    for (const p of DEMO_PAGES) expect(ACCOUNT_PAGES.has(p)).toBe(false);
  });
});

describe('resolveSearchScope: page + auth state -> scope', () => {
  it('demo pages always search the demo, whatever the auth state', () => {
    for (const a of AUTH) expect(resolveSearchScope('demo', a)).toBe('demo');
  });

  it('"other" pages always search the demo', () => {
    for (const a of AUTH) expect(resolveSearchScope('other', a)).toBe('demo');
  });

  it('account pages search the user trips when signed in', () => {
    expect(resolveSearchScope('account', 'authenticated')).toBe('user');
  });

  it('account pages head for the user scope while the sign-in check is pending', () => {
    expect(resolveSearchScope('account', 'pending')).toBe('user');
  });

  it('account pages fall back to the demo when logged out or when sign-in is unreachable', () => {
    expect(resolveSearchScope('account', 'anonymous')).toBe('demo');
    expect(resolveSearchScope('account', 'unavailable')).toBe('demo');
  });
});

describe('scopeFallback', () => {
  it('explains a demo fallback on account pages only', () => {
    expect(scopeFallback('account', 'anonymous')).toBe('signed-out');
    expect(scopeFallback('account', 'unavailable')).toBe('auth-unavailable');
    expect(scopeFallback('account', 'authenticated')).toBeNull();
    expect(scopeFallback('account', 'pending')).toBeNull();
  });

  it('is silent on demo pages: showing the demo there is not a fallback', () => {
    for (const a of AUTH) {
      expect(scopeFallback('demo', a)).toBeNull();
      expect(scopeFallback('other', a)).toBeNull();
    }
  });
});

describe('currentTripIdFromLocation', () => {
  it('reads tripId on the trip view and the editor', () => {
    expect(currentTripIdFromLocation('/PruebaMapJapan/trip.html', '?tripId=42')).toBe('42');
    expect(currentTripIdFromLocation('/PruebaMapJapan/trip-edit.html', '?x=1&tripId=abc-def')).toBe('abc-def');
  });

  it('ignores it elsewhere and when blank/missing', () => {
    expect(currentTripIdFromLocation('/dashboard.html', '?tripId=42')).toBeNull();
    expect(currentTripIdFromLocation('/trip.html', '')).toBeNull();
    expect(currentTripIdFromLocation('/trip.html', '?tripId=')).toBeNull();
    expect(currentTripIdFromLocation('/trip.html', '?tripId=%20%20')).toBeNull();
    expect(currentTripIdFromLocation('/trip.html', '?slug=public-one')).toBeNull();
  });
});

describe('scopeLabels', () => {
  it('names the scope in the placeholder, chip and accessible name', () => {
    expect(scopeLabels('user').placeholder).toBe('Search your trips');
    expect(scopeLabels('demo').placeholder).toBe('Search the demo');
    expect(scopeLabels('user').ariaLabel).toMatch(/your trips/i);
    expect(scopeLabels('demo').ariaLabel).toMatch(/demo/i);
    expect(scopeLabels('user').chip).not.toBe(scopeLabels('demo').chip);
  });
});
