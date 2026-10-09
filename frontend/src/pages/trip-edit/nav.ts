/**
 * Where the editor is, kept in the URL hash so the browser's Back button and a
 * reload both land in the same place:
 *
 *   #trip              step 1
 *   #route             step 2, the destinations list
 *   #city/<id>/<date>  a destination (server id), optionally a day
 *   #share             step 3
 */

export type NavState =
  | { step: 'trip' }
  | { step: 'route' }
  | { step: 'city'; destId: string; date: string | null }
  | { step: 'share' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseHash(hash: string): NavState | null {
  const h = hash.replace(/^#/, '');
  if (h === 'trip') return { step: 'trip' };
  if (h === 'route') return { step: 'route' };
  if (h === 'share') return { step: 'share' };
  const m = /^city\/([A-Za-z0-9-]{1,40})(?:\/(\d{4}-\d{2}-\d{2}))?$/.exec(h);
  if (m) return { step: 'city', destId: m[1]!, date: m[2] && DATE_RE.test(m[2]) ? m[2] : null };
  return null;
}

export function formatHash(nav: NavState): string {
  switch (nav.step) {
    case 'trip': return '#trip';
    case 'route': return '#route';
    case 'share': return '#share';
    case 'city': return `#city/${nav.destId}${nav.date ? `/${nav.date}` : ''}`;
  }
}

export function sameNav(a: NavState, b: NavState): boolean {
  return formatHash(a) === formatHash(b);
}

/** The step a freshly opened trip starts on: new/empty trips on the route, existing ones too. */
export function initialNav(hash: string, isNew: boolean): NavState {
  if (isNew) return { step: 'trip' };
  return parseHash(hash) ?? { step: 'route' };
}
