// Device memory for passkey-first sign-in (docs/design/PASSKEY-FIRST-LOGIN.md).
//
// The login page may start the passkey prompt by itself, with no username typed, but only on
// a browser that has already used a passkey with this realm. That fact is kept in the
// browser as a marker: it says "a passkey was used here", never WHO used it. No user name,
// user id, e-mail, credential id or session data is ever stored, so reading it tells an
// attacker with access to the page nothing about who has an account.
//
// Everything in this file is a pure function over objects handed in (storage, clock,
// capability flags): no DOM, no globals, so tests/e2e/idp-passkey-first-unit.spec.ts can
// table-test every branch, including storage that throws and clocks that jump.

export const MARKER_VERSION = 1;
/** How long a marker is trusted after the last passkey sign-in or registration. */
export const MARKER_TTL_DAYS = 180;
/** Dismissed automatic prompts in a row that make the page stop prompting by itself. */
export const MAX_MISSES = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A marker "from the future" is tolerated up to this much (clock changes, time zones). */
const CLOCK_SKEW_MS = DAY_MS;
const KEY_PREFIX = 'jp.passkey.';
/** The only fields a marker may have. Anything else makes it invalid (and it is dropped). */
const MARKER_FIELDS = ['v', 't', 'm'];

/** localStorage key for a realm; unusual characters are replaced so the key stays plain. */
export function markerKey(realm) {
  const name = typeof realm === 'string' && realm.trim() ? realm.trim() : 'default';
  return KEY_PREFIX + name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
}

/** The first storage the browser lets us use, or null (Safari private mode, blocked site data...). */
export function safeStorage(win, which = 'localStorage') {
  try {
    const storage = win?.[which];
    if (!storage || typeof storage.getItem !== 'function') return null;
    return storage;
  } catch {
    return null;
  }
}

function isValidMarker(m, nowMs, ttlMs) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  if (Object.keys(m).some((k) => !MARKER_FIELDS.includes(k))) return false;
  if (m.v !== MARKER_VERSION) return false;
  if (typeof m.t !== 'number' || !Number.isFinite(m.t)) return false;
  if (m.t > nowMs + CLOCK_SKEW_MS) return false;
  if (nowMs - m.t > ttlMs) return false;
  if (!Number.isInteger(m.m) || m.m < 0 || m.m >= MAX_MISSES) return false;
  return true;
}

/**
 * The marker store.
 *
 * @param {object} [options]
 * @param {Storage|null} [options.storage]  localStorage (or a stand-in); null/undefined = no memory
 * @param {string} [options.realm]
 * @param {() => number} [options.now]      clock in epoch milliseconds
 * @param {number} [options.ttlDays]
 */
export function createDeviceMemory({ storage, realm = 'default', now = Date.now, ttlDays = MARKER_TTL_DAYS } = {}) {
  const key = markerKey(realm);
  const ttlMs = ttlDays * DAY_MS;

  const getItem = () => {
    try {
      return storage ? storage.getItem(key) : null;
    } catch {
      return null;
    }
  };
  const setItem = (value) => {
    try {
      if (!storage) return false;
      storage.setItem(key, value);
      return true;
    } catch {
      return false; // quota, private mode, site data blocked
    }
  };
  const removeItem = () => {
    try {
      storage?.removeItem(key);
    } catch {
      // nothing else to do
    }
  };

  /** The marker if there is a valid one: { savedAt, misses }. Invalid or expired ones are removed. */
  function read() {
    const raw = getItem();
    if (typeof raw !== 'string') return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      removeItem();
      return null;
    }
    if (!isValidMarker(parsed, now(), ttlMs)) {
      removeItem();
      return null;
    }
    return { savedAt: parsed.t, misses: parsed.m };
  }

  return {
    key,
    read,
    /** True when this browser has used a passkey here recently enough to prompt by itself. */
    isActive: () => read() !== null,
    /** A passkey was just used or enrolled here: (re)start the clock, forget earlier dismissals. */
    remember() {
      return setItem(JSON.stringify({ v: MARKER_VERSION, t: now(), m: 0 }));
    },
    /** The user moved to another account, or the passkey no longer works: stop prompting. */
    forget: removeItem,
    /**
     * An automatic prompt was dismissed or found nothing. The first time the marker stays (the
     * user may simply have cancelled); at MAX_MISSES in a row it is dropped. The expiry date is
     * not extended by a miss.
     * @returns {{ dropped: boolean }}
     */
    recordMiss() {
      const current = read();
      if (!current) return { dropped: true };
      const misses = current.misses + 1;
      if (misses >= MAX_MISSES) {
        removeItem();
        return { dropped: true };
      }
      setItem(JSON.stringify({ v: MARKER_VERSION, t: current.savedAt, m: misses }));
      return { dropped: false };
    },
  };
}

/**
 * Whether the page may start the passkey prompt on its own. Pure: every input is a boolean the
 * caller measured. The first failing rule is reported (for tests and for the console).
 *
 * @param {object} input
 * @param {boolean} input.serverAllows         the template says this is a plain sign-in page (no message shown)
 * @param {boolean} input.topLevel             not inside an iframe
 * @param {boolean} input.webauthn             PublicKeyCredential and navigator.credentials.get exist
 * @param {boolean} input.markerActive         a valid marker is present
 * @param {boolean} [input.freshNavigation]    the page was reached by a new navigation, not a reload or history (default true)
 * @param {boolean} input.alreadyPrompted      this login attempt (tab) already got its one prompt
 * @param {boolean} input.platformAuthenticator isUserVerifyingPlatformAuthenticatorAvailable() answer
 * @returns {{ auto: boolean, reason: string }}
 */
export function decideAutoPrompt({
  serverAllows,
  topLevel,
  webauthn,
  markerActive,
  freshNavigation = true,
  alreadyPrompted,
  platformAuthenticator,
}) {
  if (!serverAllows) return { auto: false, reason: 'page-not-eligible' };
  if (!topLevel) return { auto: false, reason: 'framed' };
  if (!webauthn) return { auto: false, reason: 'no-webauthn' };
  if (!markerActive) return { auto: false, reason: 'no-marker' };
  // A reload or a back/forward trip is the user returning to what they already saw (and may
  // have cancelled), not a new sign-in: the page stays put.
  if (!freshNavigation) return { auto: false, reason: 'reload-or-history' };
  if (alreadyPrompted) return { auto: false, reason: 'already-prompted' };
  if (!platformAuthenticator) return { auto: false, reason: 'no-platform-authenticator' };
  return { auto: true, reason: 'marker' };
}

/**
 * What a rejected navigator.credentials.get() means for the page.
 *  dismissed   the user cancelled, the request timed out, or no passkey was available
 *              (browsers deliberately do not tell these apart: NotAllowedError)
 *  blocked     the page may not use WebAuthn here (wrong origin/rp id, permissions policy)
 *  unsupported this browser or device cannot do it
 *  failed      anything else
 */
export function classifyCredentialError(error) {
  const name = error && typeof error === 'object' && typeof error.name === 'string' ? error.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError' || name === 'InvalidStateError') return 'dismissed';
  if (name === 'SecurityError') return 'blocked';
  if (name === 'NotSupportedError') return 'unsupported';
  return 'failed';
}

/**
 * Chromium's "immediate" mediation fails at once, without any browser UI, when the device has
 * no passkey for the site. It is used only where the browser says it has it (client
 * capabilities); everywhere else the modal prompt runs and "no passkey" looks like a cancel.
 */
export function supportsImmediateMediation(capabilities) {
  return !!capabilities && typeof capabilities === 'object' && capabilities.immediateGet === true;
}

/** The login attempt Keycloak is working on: its tab_id query parameter ('' when absent). */
export function tabIdOf(href) {
  if (typeof href !== 'string' || !href) return '';
  try {
    return new URL(href, 'http://invalid.example').searchParams.get('tab_id') ?? '';
  } catch {
    return '';
  }
}

/** True for a navigation the user started (typing, link, redirect), false for reload and back/forward. */
export function isFreshNavigation(type) {
  return type !== 'reload' && type !== 'back_forward';
}

const GATE_KEY = 'jp.passkey.auto-tab';
const PENDING_KEY = 'jp.passkey.pending-tab';

/**
 * Per-tab bookkeeping in sessionStorage (it dies with the tab; nothing here outlives the
 * login attempt):
 *  - claimAutoPrompt: the one automatic prompt of a login attempt (reload and back navigation
 *    inside the same attempt do not prompt again);
 *  - markPending / wasPending: a passkey answer was posted from this attempt; if the next page
 *    of the same attempt is an error page, the server did not accept it.
 */
export function createTabGate(storage, tabId) {
  let claimed = false; // used when sessionStorage is unavailable: at least once per page load
  const get = (k) => {
    try {
      return storage ? storage.getItem(k) : null;
    } catch {
      return null;
    }
  };
  const set = (k, v) => {
    try {
      storage?.setItem(k, v);
    } catch {
      // ignored
    }
  };
  const remove = (k) => {
    try {
      storage?.removeItem(k);
    } catch {
      // ignored
    }
  };
  const id = tabId || 'no-tab';
  return {
    hasPrompted: () => claimed || get(GATE_KEY) === id,
    claimAutoPrompt() {
      if (claimed || get(GATE_KEY) === id) return false;
      claimed = true;
      set(GATE_KEY, id);
      return true;
    },
    markPending: () => set(PENDING_KEY, id),
    wasPending: () => get(PENDING_KEY) === id,
    clearPending: () => remove(PENDING_KEY),
  };
}
