// Profile "Add a password as a backup" card: who sees it, throttling, and the card itself.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/auth/keycloak', () => ({
  keycloak: { login: vi.fn() },
  loginRedirectUri: () => 'x',
  getToken: vi.fn(async () => 'tok'),
  keycloakBaseUrl: () => 'http://kc.test',
  KEYCLOAK_REALM: 'japan-trip',
}));
vi.mock('@/modules/toast', () => ({ showToast: vi.fn() }));

import {
  shouldShowPasswordBackup,
  renderPasswordBackupCard,
  PASSWORD_BACKUP_FIELD,
  PASSWORD_BACKUP_ID,
} from '@/modules/passwordBackup';
import { createPrefsStore, SNOOZE_MS, MAX_SHOWS, LOCAL_KEY_PREFIX, PREFS_FIELD } from '@/modules/passkeyCampaign';

const NOW = 1_800_000_000_000;

function counts(passkeys: number | null, passwords: number | null) {
  return vi.fn(async (type: string) => (type === 'password' ? passwords : passkeys));
}
function store(accountPrefs: Record<string, unknown> | null = null) {
  const patch = vi.fn(async () => ({}));
  return { s: createPrefsStore('u1', accountPrefs, patch, PASSWORD_BACKUP_FIELD), patch };
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '<div id="c"><h1>Profile</h1></div>';
});

describe('who sees the password backup card', () => {
  it('a passkey-only user does, and the impression is recorded under its own field', async () => {
    const { s, patch } = store({ theme: 'dark', [PREFS_FIELD]: { never: true } });
    expect(await shouldShowPasswordBackup({ store: s, now: () => NOW, count: counts(1, 0) })).toBe(true);
    expect(patch).toHaveBeenCalledWith({
      theme: 'dark',
      [PREFS_FIELD]: { never: true }, // the onboarding campaign's state is untouched
      [PASSWORD_BACKUP_FIELD]: { never: false, snoozeUntil: NOW + SNOOZE_MS, shown: 1 },
    });
    expect(window.localStorage.getItem(`${LOCAL_KEY_PREFIX}${PASSWORD_BACKUP_FIELD}.u1`)).not.toBeNull();
  });

  it('not for a user who already has a password', async () => {
    const { s, patch } = store();
    expect(await shouldShowPasswordBackup({ store: s, now: () => NOW, count: counts(2, 1) })).toBe(false);
    expect(patch).not.toHaveBeenCalled();
  });

  it('not for a user with no passkey', async () => {
    expect(await shouldShowPasswordBackup({ store: store().s, now: () => NOW, count: counts(0, 0) })).toBe(false);
  });

  it('quiet when the credential lists cannot be read', async () => {
    expect(await shouldShowPasswordBackup({ store: store().s, now: () => NOW, count: counts(null, 0) })).toBe(false);
    expect(await shouldShowPasswordBackup({ store: store().s, now: () => NOW, count: counts(1, null) })).toBe(false);
  });

  it('is throttled for a week and capped', async () => {
    const { s } = store();
    const ctx = (now: number) => ({ store: s, now: () => now, count: counts(1, 0) });
    expect(await shouldShowPasswordBackup(ctx(NOW))).toBe(true);
    expect(await shouldShowPasswordBackup(ctx(NOW + 1000))).toBe(false);
    let t = NOW;
    for (let i = 1; i < MAX_SHOWS; i++) {
      t += SNOOZE_MS + 1;
      expect(await shouldShowPasswordBackup(ctx(t))).toBe(true);
    }
    t += SNOOZE_MS + 1;
    expect(await shouldShowPasswordBackup(ctx(t))).toBe(false);
  });

  it('is independent of the onboarding campaign state', async () => {
    const onboardingStore = createPrefsStore('u1', null, vi.fn(async () => ({})));
    await onboardingStore.save({ never: true, snoozeUntil: 0, shown: 3 });
    expect(await shouldShowPasswordBackup({ store: store().s, now: () => NOW, count: counts(1, 0) })).toBe(true);
  });
});

describe('the card', () => {
  const container = () => document.getElementById('c')!;

  it('is a labelled section with an Add button and a Not now button', () => {
    renderPasswordBackupCard(container(), { start: async () => {}, locale: 'en' });
    const card = document.getElementById(PASSWORD_BACKUP_ID)!;
    expect(card.getAttribute('aria-labelledby')).toBe(`${PASSWORD_BACKUP_ID}-title`);
    expect(card.querySelector('h2')!.textContent).toBe('Add a password as a backup');
    expect(card.querySelector(`#${PASSWORD_BACKUP_ID}-add`)!.textContent).toBe('Add a password');
    expect(card.querySelector(`#${PASSWORD_BACKUP_ID}-later`)!.textContent).toBe('Not now');
    expect(card.lang).toBe('en');
    expect(container().firstElementChild).toBe(card);
  });

  it('Add starts the password step once (double click)', () => {
    const start = vi.fn(() => new Promise<void>(() => {}));
    renderPasswordBackupCard(container(), { start, locale: 'en' });
    const add = document.getElementById(`${PASSWORD_BACKUP_ID}-add`) as HTMLButtonElement;
    add.click();
    add.click();
    expect(start).toHaveBeenCalledTimes(1);
    expect(add.disabled).toBe(true);
  });

  it('a failed start re-enables the button and reports', async () => {
    const onError = vi.fn();
    renderPasswordBackupCard(container(), { start: async () => { throw new Error('kc'); }, onError, locale: 'en' });
    const add = document.getElementById(`${PASSWORD_BACKUP_ID}-add`) as HTMLButtonElement;
    add.click();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Couldn't open password setup. Please try again."));
    expect(add.disabled).toBe(false);
  });

  it('Not now removes the card and moves focus to the page heading', () => {
    renderPasswordBackupCard(container(), { start: async () => {}, locale: 'en' });
    (document.getElementById(`${PASSWORD_BACKUP_ID}-later`) as HTMLButtonElement).click();
    expect(document.getElementById(PASSWORD_BACKUP_ID)).toBeNull();
    expect(document.activeElement).toBe(container().querySelector('h1'));
  });

  it('speaks Spanish when asked', () => {
    renderPasswordBackupCard(container(), { start: async () => {}, locale: 'es' });
    expect(document.querySelector('h2')!.textContent).toBe('Crea una contraseña de respaldo');
    expect(document.getElementById(PASSWORD_BACKUP_ID)!.lang).toBe('es');
  });
});
