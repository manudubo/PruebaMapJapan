/**
 * "Add a password as a backup" card on the profile page, for users who sign in with a passkey
 * only: if that passkey is lost or the device has none, a password still gets them in (and
 * recover.html can set one without it). Same throttle/persistence as the onboarding dialog
 * (src/modules/passkeyCampaign.ts), under its own preferences field.
 *
 * Shown only when the account has a passkey and no password; "Not now" hides it for a week
 * (at most MAX_SHOWS times). The action is the same Keycloak UPDATE_PASSWORD step as
 * "Change password".
 */

import { authLocale, authText, type AuthLocale, type AuthMessageKey } from '@/auth/authMessages';
import { countCredentials, isThrottled, SNOOZE_MS, type PrefsStore } from '@/modules/passkeyCampaign';

export const PASSWORD_BACKUP_FIELD = 'passwordBackupCampaign';
export const PASSWORD_BACKUP_ID = 'password-backup';

export interface PasswordBackupContext {
  store: PrefsStore;
  now?: () => number;
  count?: (type: string) => Promise<number | null>;
}

/** Whether the card should be shown now (and records the impression when it is). */
export async function shouldShowPasswordBackup(ctx: PasswordBackupContext): Promise<boolean> {
  const now = (ctx.now ?? (() => Date.now()))();
  const prefs = ctx.store.load();
  if (isThrottled(prefs, now)) return false;
  const count = ctx.count ?? countCredentials;
  const [passkeys, passwords] = await Promise.all([count('webauthn-passwordless'), count('password')]);
  // Unknown (API error) is not "none": stay quiet rather than nag someone who has a password.
  if (passkeys === null || passwords === null) return false;
  if (passkeys === 0 || passwords > 0) return false;
  await ctx.store.save({ never: false, snoozeUntil: now + SNOOZE_MS, shown: prefs.shown + 1 });
  return true;
}

export interface PasswordBackupCardOptions {
  /** Starts the Keycloak password step; may reject. */
  start: () => Promise<void>;
  onError?: (message: string) => void;
  locale?: AuthLocale;
}

/** Build the card and insert it as the first child of `container`. Returns it. */
export function renderPasswordBackupCard(container: HTMLElement, options: PasswordBackupCardOptions): HTMLElement {
  const locale = options.locale ?? authLocale();
  const t = (key: AuthMessageKey): string => authText(key, locale);

  const card = document.createElement('section');
  card.className = 'password-backup';
  card.id = PASSWORD_BACKUP_ID;
  card.lang = locale;
  card.setAttribute('aria-labelledby', `${PASSWORD_BACKUP_ID}-title`);

  const title = document.createElement('h2');
  title.id = `${PASSWORD_BACKUP_ID}-title`;
  title.className = 'password-backup-title';
  title.textContent = t('pwBackupTitle');
  const body = document.createElement('p');
  body.className = 'password-backup-body';
  body.textContent = t('pwBackupBody');

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-primary';
  add.id = `${PASSWORD_BACKUP_ID}-add`;
  add.textContent = t('pwBackupAction');
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'btn btn-secondary';
  later.id = `${PASSWORD_BACKUP_ID}-later`;
  later.textContent = t('pwBackupLater');
  const actions = document.createElement('div');
  actions.className = 'password-backup-actions';
  actions.append(add, later);
  card.append(title, body, actions);

  let busy = false;
  add.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    add.disabled = true;
    add.setAttribute('aria-busy', 'true');
    options.start().catch(() => {
      busy = false;
      add.disabled = false;
      add.removeAttribute('aria-busy');
      options.onError?.(t('pwBackupStartFailed'));
    });
  });
  later.addEventListener('click', () => {
    // Already recorded as a snooze when shown: just get out of the way, keeping focus sensible.
    const next = container.querySelector<HTMLElement>('h1, h2:not(.password-backup-title)');
    card.remove();
    next?.setAttribute('tabindex', '-1');
    next?.focus();
  });

  container.prepend(card);
  return card;
}
