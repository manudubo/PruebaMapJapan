/**
 * Words for the header's save indicator and the recovery banners.
 * Pure: the DOM side only renders what these return.
 */

import type { QueueSnapshot } from './saveQueue';

export type StatusState = 'idle' | 'saved' | 'saving' | 'error' | 'offline';

export interface StatusView {
  state: StatusState;
  text: string;
}

export function describeStatus(s: QueueSnapshot, dirty = false): StatusView {
  if (s.status === 'error') return { state: 'error', text: "Couldn't save" };
  if (s.status === 'offline') return { state: 'offline', text: 'Offline · will save when you’re back' };
  if (s.status === 'saving' || dirty) return { state: 'saving', text: 'Saving…' };
  if (s.lastSavedAt !== null) return { state: 'saved', text: 'Saved' };
  return { state: 'idle', text: 'Changes save automatically' };
}

export interface BannerView {
  kind: 'error' | 'offline' | 'issues';
  title: string;
  detail: string;
  /** Show a Retry button. */
  retry: boolean;
  /** Show Reload-from-server. */
  reload: boolean;
}

/** The persistent banner for the current snapshot, or null when there is nothing to say. */
export function describeBanner(s: QueueSnapshot): BannerView | null {
  if (s.error) {
    const auth = s.error.kind === 'auth';
    const verify = s.error.kind === 'verify';
    return {
      kind: 'error',
      title: verify ? 'Verify your email to keep saving' : 'Your latest changes are not saved yet',
      detail: s.error.willRetry ? `${s.error.message} Trying again…` : s.error.message,
      retry: !auth,
      reload: false,
    };
  }
  if (s.status === 'offline') {
    return {
      kind: 'offline',
      title: 'You’re offline',
      detail: 'Your changes are kept on this page and will be saved as soon as you reconnect. Don’t close the tab yet.',
      retry: false,
      reload: false,
    };
  }
  if (s.issues.length > 0) {
    const first = s.issues[0]!;
    const more = s.issues.length > 1 ? ` (and ${s.issues.length - 1} more)` : '';
    return {
      kind: 'issues',
      title: 'Some changes could not be saved',
      detail: `${first.label}: ${first.message}${more}`,
      retry: false,
      reload: true,
    };
  }
  return null;
}
