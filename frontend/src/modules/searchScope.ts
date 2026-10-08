/**
 * What the search box searches, decided by where the visitor is and whether they are signed in.
 *
 *  - 'demo': the static Japan itinerary shipped with the app (src/data/itinerary.ts).
 *  - 'user': the signed-in user's own trips, loaded from the API.
 *
 * Everything here is pure (no DOM, no network) so the rules are unit-testable.
 */

import type { AuthStatus } from '@/auth/keycloak';

export type SearchScope = 'demo' | 'user';

/**
 * - 'demo':    the landing page and the static city pages. They show the demo itinerary, so
 *              they search it, signed in or not.
 * - 'account': pages that belong to a signed-in user (dashboard, trip view/editor, profile).
 * - 'other':   anything else (account recovery, unknown paths). Not tied to a trip.
 */
export type PageKind = 'demo' | 'account' | 'other';

export const DEMO_PAGES: ReadonlySet<string> = new Set([
  'index.html',
  'tokyo.html',
  'nagoya.html',
  'takayama.html',
  'kyoto.html',
  'osaka.html',
  'naoshima.html',
  'hakone.html',
  'tokyo2.html',
]);

export const ACCOUNT_PAGES: ReadonlySet<string> = new Set([
  'dashboard.html',
  'trip.html',
  'trip-edit.html',
  'profile.html',
]);

/** Last path segment, lower-cased; '' or a trailing slash is the site root (index.html). */
export function pageNameFromPath(pathname: string): string {
  const last = pathname.split('/').pop() ?? '';
  return (last === '' ? 'index.html' : last).toLowerCase();
}

export function pageKindFromPath(pathname: string): PageKind {
  const name = pageNameFromPath(pathname);
  if (DEMO_PAGES.has(name)) return 'demo';
  if (ACCOUNT_PAGES.has(name)) return 'account';
  return 'other';
}

/**
 * Scope for a page and an auth status.
 *
 * Account pages search the user's trips once signed in. While the sign-in check is still
 * 'pending' the answer is 'user' (that is where the visitor is headed; the box shows a
 * loading state until the check settles). Anonymous visitors and an unreachable identity
 * provider fall back to the demo, so the box always has something to search.
 */
export function resolveSearchScope(page: PageKind, auth: AuthStatus): SearchScope {
  if (page === 'demo' || page === 'other') return 'demo';
  return auth === 'authenticated' || auth === 'pending' ? 'user' : 'demo';
}

/**
 * Why a visitor on a trip/account page is getting demo results, if they are:
 * 'signed-out' (offer sign-in) or 'auth-unavailable' (offer retry). null when the scope is
 * what the page implies.
 */
export type ScopeFallback = 'signed-out' | 'auth-unavailable';

export function scopeFallback(page: PageKind, auth: AuthStatus): ScopeFallback | null {
  if (page !== 'account') return null;
  if (auth === 'anonymous') return 'signed-out';
  if (auth === 'unavailable') return 'auth-unavailable';
  return null;
}

/** The trip the visitor is looking at (trip.html / trip-edit.html ?tripId=), if any. */
export function currentTripIdFromLocation(pathname: string, search: string): string | null {
  const name = pageNameFromPath(pathname);
  if (name !== 'trip.html' && name !== 'trip-edit.html') return null;
  const id = new URLSearchParams(search).get('tripId');
  return id && id.trim() !== '' ? id.trim() : null;
}

export interface ScopeLabels {
  /** Input placeholder and short chip text. */
  placeholder: string;
  chip: string;
  ariaLabel: string;
}

export function scopeLabels(scope: SearchScope): ScopeLabels {
  return scope === 'user'
    ? {
        placeholder: 'Search your trips',
        chip: 'Your trips',
        ariaLabel: 'Search your trips: cities, days, activities',
      }
    : {
        placeholder: 'Search the demo',
        chip: 'Demo trip',
        ariaLabel: 'Search the demo itinerary: places, days, activities',
      };
}
