/**
 * Passkey campaigns.
 *
 * - checkPasskeyCampaign(): the existing-user nudge (unchanged): once per device, WebAuthn
 *   capable users are sent straight to Keycloak's passkey registration.
 * - runNewUserOnboarding(): for a just-registered account (GET /users/me -> onboarding.is_new)
 *   that finished email verification. A dialog, never a surprise redirect:
 *     "Create a passkey" / "Not now" / "Don't ask again".
 *   Rules: only when the device can really create a passkey (PublicKeyCredential +
 *   isUserVerifyingPlatformAuthenticatorAvailable, both guarded); never for a user who already
 *   has a passkey; throttled ("Not now" = ask again in a week, at most MAX_SHOWS times,
 *   "Don't ask again" = never); the choice lives in the user's preferences
 *   (PATCH /users/me) with a localStorage copy, so it holds on another device and when the
 *   API is down. Where passkeys are unsupported the same dialog suggests a password as a
 *   backup instead.
 */

import { keycloak, loginRedirectUri, getToken, keycloakBaseUrl, KEYCLOAK_REALM } from '@/auth/keycloak';
import { authLocale, authText, type AuthLocale, type AuthMessageKey } from '@/auth/authMessages';
import { showToast } from '@/modules/toast';

export function checkPasskeyCampaign(userId: string): void {
  // WebAuthn capability check (D-12)
  if (typeof PublicKeyCredential === 'undefined') return;

  // Per-device cookie check — equals sign prevents prefix collision with longer userIds (D-13)
  if (document.cookie.includes(`pnk_${userId}=`)) return;

  // Write cookie BEFORE redirect to prevent loop if KC registration fails (D-14)
  // No Secure flag — would block cookie on http://localhost
  document.cookie = `pnk_${userId}=1; max-age=2592000; SameSite=Strict`;

  // Redirect to passkey registration AIA (D-15)
  void keycloak.login({
    action: 'webauthn-register-passwordless',
    redirectUri: loginRedirectUri(),
  });
}

// ---------------------------------------------------------------------------
// Throttle state
// ---------------------------------------------------------------------------

export interface CampaignPrefs {
  /** "Don't ask again". */
  never: boolean;
  /** Epoch ms before which the dialog is not shown again. */
  snoozeUntil: number;
  /** How many times the dialog was shown. */
  shown: number;
}

export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_SHOWS = 3;
export const PREFS_FIELD = 'passkeyCampaign';
export const LOCAL_KEY_PREFIX = 'travelmap.passkeyCampaign.';

const EMPTY: CampaignPrefs = { never: false, snoozeUntil: 0, shown: 0 };

/** Tolerant parse of whatever a preferences blob or storage holds. */
export function parsePrefs(raw: unknown): CampaignPrefs {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ...EMPTY };
    }
  }
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY };
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return { never: r['never'] === true, snoozeUntil: num(r['snoozeUntil']), shown: Math.floor(num(r['shown'])) };
}

/** The more restrictive of two copies (account preferences vs this browser). */
export function mergePrefs(a: CampaignPrefs, b: CampaignPrefs): CampaignPrefs {
  return {
    never: a.never || b.never,
    snoozeUntil: Math.max(a.snoozeUntil, b.snoozeUntil),
    shown: Math.max(a.shown, b.shown),
  };
}

export function isThrottled(prefs: CampaignPrefs, now: number): boolean {
  return prefs.never || prefs.shown >= MAX_SHOWS || prefs.snoozeUntil > now;
}

export interface PrefsStore {
  load(): CampaignPrefs;
  save(next: CampaignPrefs): Promise<void>;
}

/**
 * Preferences store: the account preferences (`accountPrefs` as loaded from GET /users/me,
 * written back with `patch`) merged with a localStorage copy. Every storage/network failure
 * is swallowed: the campaign then just falls back to the other copy.
 */
export function createPrefsStore(
  userKey: string,
  accountPrefs: Record<string, unknown> | null,
  patch: (preferences: Record<string, unknown>) => Promise<unknown>,
  /** Which campaign: its field in the preferences and its localStorage key suffix. */
  field: string = PREFS_FIELD,
): PrefsStore {
  const key = LOCAL_KEY_PREFIX + (field === PREFS_FIELD ? '' : `${field}.`) + userKey;
  let current = parsePrefs(accountPrefs?.[field]);
  return {
    load() {
      let local = { ...EMPTY };
      try {
        local = parsePrefs(window.localStorage.getItem(key));
      } catch {
        // blocked: account copy only
      }
      return mergePrefs(current, local);
    },
    async save(next) {
      current = mergePrefs(current, next);
      try {
        window.localStorage.setItem(key, JSON.stringify(current));
      } catch {
        // blocked: account copy only
      }
      try {
        await patch({ ...(accountPrefs ?? {}), [field]: current });
      } catch {
        // API down or 403: the local copy still throttles this browser.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Capability + credential checks
// ---------------------------------------------------------------------------

/** True when this device can create a passkey (guarded: old browsers, privacy extensions). */
export async function detectPasskeySupport(): Promise<boolean> {
  try {
    const PKC = (window as { PublicKeyCredential?: typeof PublicKeyCredential }).PublicKeyCredential;
    if (typeof PKC === 'undefined') return false;
    if (typeof PKC.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return true; // security keys still work
    return (await PKC.isUserVerifyingPlatformAuthenticatorAvailable()) === true;
  } catch {
    return false;
  }
}

/**
 * How many credentials of a Keycloak type ('webauthn-passwordless', 'password') the user has,
 * from the account REST API (the same call profile.html makes). null when unknown.
 */
export async function countCredentials(type: string): Promise<number | null> {
  try {
    const token = await getToken();
    const res = await fetch(
      `${keycloakBaseUrl(import.meta.env['VITE_KEYCLOAK_URL'] as string | undefined)}/realms/${KEYCLOAK_REALM}/account/credentials?type=${encodeURIComponent(type)}`,
      { credentials: 'include', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const types = (await res.json()) as Array<{ type?: string; userCredentialMetadatas?: unknown[] }>;
    const match = types.find((c) => c.type === type);
    return match?.userCredentialMetadatas?.length ?? 0;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export type OnboardingMode = 'passkey' | 'password';
export type OnboardingChoice = 'create' | 'later' | 'never';

export const DIALOG_ID = 'passkey-onboarding';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface OnboardingDialogOptions {
  mode: OnboardingMode;
  /** Runs on "Create a passkey" / "Set a password"; it normally navigates away. May reject. */
  start: () => Promise<void>;
  locale?: AuthLocale;
}

/**
 * Show the modal and resolve with the choice. Escape and "Not now" are "later". Focus goes to
 * the primary action, is trapped inside, and returns to where it was. The rest of the page is
 * inert while it is open.
 */
export function showOnboardingDialog(options: OnboardingDialogOptions): Promise<OnboardingChoice> {
  const locale = options.locale ?? authLocale();
  const t = (key: AuthMessageKey): string => authText(key, locale);
  const pw = options.mode === 'password';
  const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  return new Promise<OnboardingChoice>((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay onboarding-overlay';
    overlay.id = DIALOG_ID;

    const dialog = document.createElement('div');
    dialog.className = 'modal onboarding-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', `${DIALOG_ID}-title`);
    dialog.setAttribute('aria-describedby', `${DIALOG_ID}-body`);
    dialog.lang = locale;

    const title = document.createElement('h2');
    title.id = `${DIALOG_ID}-title`;
    title.textContent = t(pw ? 'onboardPwTitle' : 'onboardTitle');
    const body = document.createElement('p');
    body.id = `${DIALOG_ID}-body`;
    body.className = 'onboarding-body';
    body.textContent = t(pw ? 'onboardPwBody' : 'onboardBody');

    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'btn btn-primary';
    create.id = `${DIALOG_ID}-create`;
    create.textContent = t(pw ? 'onboardPwAction' : 'onboardCreate');
    const later = document.createElement('button');
    later.type = 'button';
    later.className = 'btn btn-secondary';
    later.id = `${DIALOG_ID}-later`;
    later.textContent = t('onboardLater');
    const never = document.createElement('button');
    never.type = 'button';
    never.className = 'btn btn-link';
    never.id = `${DIALOG_ID}-never`;
    never.textContent = t('onboardNever');

    const actions = document.createElement('div');
    actions.className = 'onboarding-actions';
    actions.append(create, later, never);
    dialog.append(title, body, actions);
    overlay.appendChild(dialog);

    // Everything else is inert (and hidden from assistive tech) while the dialog is open.
    const inerted: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child instanceof HTMLElement && child.id !== 'toast-container' && !child.hasAttribute('inert')) {
        child.setAttribute('inert', '');
        inerted.push(child);
      }
    }
    document.body.appendChild(overlay);

    let busy = false;
    let closed = false;
    const close = (choice: OnboardingChoice): void => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      inerted.forEach((el) => el.removeAttribute('inert'));
      if (choice !== 'create' && returnTo?.isConnected) returnTo.focus();
      resolve(choice);
    };

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!busy) close('later');
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey, true);

    create.addEventListener('click', () => {
      if (busy) return;
      busy = true;
      create.disabled = true;
      create.setAttribute('aria-busy', 'true');
      options.start().then(
        () => close('create'),
        () => {
          busy = false;
          create.disabled = false;
          create.removeAttribute('aria-busy');
          showToast(t('onboardStartFailed'), 'error');
          create.focus();
        },
      );
    });
    later.addEventListener('click', () => { if (!busy) close('later'); });
    never.addEventListener('click', () => { if (!busy) close('never'); });

    create.focus();
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface OnboardingContext {
  /** GET /users/me -> onboarding.is_new */
  isNew: boolean;
  userKey: string;
  store: PrefsStore;
  now?: () => number;
  supported?: () => Promise<boolean>;
  countCredentials?: (type: string) => Promise<number | null>;
  show?: (options: OnboardingDialogOptions) => Promise<OnboardingChoice>;
  startPasskey?: () => Promise<void>;
  startPassword?: () => Promise<void>;
}

export type OnboardingOutcome =
  | 'not-new'
  | 'throttled'
  | 'has-credential'
  | 'unknown-credentials'
  | OnboardingChoice;

export async function runNewUserOnboarding(ctx: OnboardingContext): Promise<OnboardingOutcome> {
  if (!ctx.isNew) return 'not-new';
  const now = ctx.now ?? (() => Date.now());
  const prefs = ctx.store.load();
  if (isThrottled(prefs, now())) return 'throttled';

  const supported = await (ctx.supported ?? detectPasskeySupport)();
  const mode: OnboardingMode = supported ? 'passkey' : 'password';
  const count = await (ctx.countCredentials ?? countCredentials)(supported ? 'webauthn-passwordless' : 'password');
  if (count === null) return 'unknown-credentials';
  if (count > 0) return 'has-credential';

  // Recorded when shown (not when answered): a reload with the dialog open is a "Not now".
  await ctx.store.save({ never: false, snoozeUntil: now() + SNOOZE_MS, shown: prefs.shown + 1 });

  const action = supported ? 'webauthn-register-passwordless' : 'UPDATE_PASSWORD';
  const start =
    (supported ? ctx.startPasskey : ctx.startPassword) ??
    (() => keycloak.login({ action, redirectUri: loginRedirectUri() }));
  const choice = await (ctx.show ?? showOnboardingDialog)({ mode, start });
  if (choice === 'never') await ctx.store.save({ never: true, snoozeUntil: 0, shown: prefs.shown + 1 });
  return choice;
}
