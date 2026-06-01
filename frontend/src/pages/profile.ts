import '@/styles/main.css';
import '@/components/Navbar';
import '@/components/SearchBar';

import { initTheme } from '@/modules/theme';
import {
  initKeycloak,
  getUserInfo,
  logout,
  keycloak,
} from '@/auth/keycloak';
import { getMe } from '@/api/client';
import { installGlobalErrorHandler } from '@/modules/toast';

const KEYCLOAK_URL = import.meta.env['VITE_KEYCLOAK_URL'] as string ?? 'http://localhost:8080';
const KEYCLOAK_REALM = import.meta.env['VITE_KEYCLOAK_REALM'] as string ?? 'japan-trip';

let credentialCount = 0;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function showStatus(
  id: string,
  message: string,
  type: 'success' | 'error',
): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.className = `status-msg status-msg--${type}`;
  el.removeAttribute('hidden');
  setTimeout(() => el.setAttribute('hidden', ''), 5000);
}

// ---------------------------------------------------------------------------
// Passkeys (via Keycloak account REST API v1)
// ---------------------------------------------------------------------------

// KC 26 Account API returns credential types with nested userCredentialMetadatas
interface CredentialEntry {
  id: string;
  type: string;
  userLabel?: string;
  createdDate?: number;
}

interface CredentialTypeResponse {
  type: string;
  userCredentialMetadatas: Array<{ credential: CredentialEntry }>;
}

async function loadPasskeys(): Promise<void> {
  const list = document.getElementById('passkey-list');
  if (!list) return;

  try {
    const token = keycloak.token;
    const res = await fetch(
      `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/account/credentials?type=webauthn-passwordless`,
      {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      },
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const credentialTypes: CredentialTypeResponse[] = await res.json() as CredentialTypeResponse[];
    const passkeyType = credentialTypes.find((c) => c.type === 'webauthn-passwordless');
    const credentials = passkeyType?.userCredentialMetadatas.map((m) => m.credential) ?? [];
    credentialCount = credentials.length; // D-16: no extra API call

    if (credentials.length === 0) {
      list.innerHTML =
        '<li class="passkey-empty">You don\'t have any passkeys registered yet.</li>';
      return;
    }

    list.innerHTML = credentials
      .map((c) => {
        const label = c.userLabel ?? 'Passkey';
        const created = c.createdDate
          ? new Date(c.createdDate).toLocaleDateString('en-US', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
          : '';
        return `
        <li class="passkey-item" data-credential-id="${c.id}">
          <div class="passkey-info">
            <span class="passkey-name">${label}</span>
            ${created ? `<span class="passkey-meta">Registered: ${created}</span>` : ''}
          </div>
          <button class="btn btn-danger" type="button" data-credential-id="${c.id}" data-passkey-delete>
            Delete
          </button>
        </li>`;
      })
      .join('');

    list.querySelectorAll<HTMLButtonElement>('[data-passkey-delete]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const credId = btn.dataset.credentialId;
        if (credId) openDeleteConfirm(credId);
      });
    });
  } catch {
    list.innerHTML =
      '<li class="passkey-empty">Could not load passkey list.</li>';
  }
}

async function registerPasskey(): Promise<void> {
  const btn = document.getElementById('btn-add-passkey') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;

  try {
    await keycloak.login({
      action: 'webauthn-register-passwordless',
      redirectUri: window.location.href,
    });
  } catch {
    showStatus('passkey-status', 'Error starting passkey registration.', 'error');
    if (btn) btn.disabled = false;
  }
}

async function changePassword(): Promise<void> {
  const btn = document.getElementById('btn-change-password') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;

  try {
    await keycloak.login({
      action: 'UPDATE_PASSWORD',
      redirectUri: window.location.href,
    });
  } catch {
    showStatus('passkey-status', 'Error starting password change.', 'error');
    if (btn) btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Delete passkey modal
// ---------------------------------------------------------------------------

function buildDeleteModal(): void {
  if (document.getElementById('passkey-delete-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'passkey-delete-overlay';
  overlay.setAttribute('hidden', '');

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <h2>Delete passkey?</h2>
    <p>This action cannot be undone.</p>
    <div class="form-actions">
      <button class="btn btn-secondary" id="passkey-delete-cancel">Cancel</button>
      <button class="btn btn-danger" id="passkey-delete-confirm">Delete</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function openDeleteConfirm(credentialId: string): void {
  const overlay = document.getElementById('passkey-delete-overlay');
  const cancelBtn = document.getElementById('passkey-delete-cancel');
  const confirmBtn = document.getElementById('passkey-delete-confirm');

  if (!overlay || !cancelBtn || !confirmBtn) return;

  overlay.removeAttribute('hidden');

  // Clone buttons to strip prior event listeners (destinations.ts pattern, line 348-352)
  const freshCancel = cancelBtn.cloneNode(true) as HTMLButtonElement;
  cancelBtn.parentNode?.replaceChild(freshCancel, cancelBtn);
  const freshConfirm = confirmBtn.cloneNode(true) as HTMLButtonElement;
  confirmBtn.parentNode?.replaceChild(freshConfirm, confirmBtn);

  const close = (): void => {
    overlay.setAttribute('hidden', '');
    document.removeEventListener('keydown', onEscape);
    // Reset guard state so the modal is clean for the next open
    overlay.querySelector('[data-passkey-guard]')?.remove();
    const modalP = overlay.querySelector('p');
    if (modalP) modalP.textContent = 'This action cannot be undone.';
    freshConfirm.removeAttribute('hidden');
  };
  const onEscape = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onEscape);

  freshCancel.addEventListener('click', close, { once: true });

  if (credentialCount === 1) {
    // D-17/D-18: Last credential guard — hide Delete, show Register button
    const modalP = overlay.querySelector('p');
    if (modalP) {
      modalP.textContent =
        'You must register another passkey on another device before deleting this one.';
    }
    freshConfirm.setAttribute('hidden', '');

    const guardBtn = document.createElement('button');
    guardBtn.className = 'btn btn-primary';
    guardBtn.setAttribute('data-passkey-guard', '');
    guardBtn.textContent = 'Register another passkey first';
    freshConfirm.parentNode?.insertBefore(guardBtn, freshConfirm);

    // D-19: same AIA call as registerPasskey()
    guardBtn.addEventListener('click', () => {
      keycloak.login({
        action: 'webauthn-register-passwordless',
        redirectUri: window.location.href,
      }).catch(() => { /* non-fatal if KC unavailable */ });
    }, { once: true });
  } else {
    // KC 26 DELETE /account/credentials/{id} returns 405 for WebAuthn credentials.
    // Use the AIA flow instead: KC deletes the credential server-side and redirects back.
    freshConfirm.addEventListener('click', () => {
      freshConfirm.disabled = true;
      freshConfirm.textContent = 'Deleting…';
      keycloak.login({
        action: `delete_credential:${credentialId}`,
        redirectUri: window.location.href,
      }).catch(() => {
        freshConfirm.disabled = false;
        freshConfirm.textContent = 'Delete';
      });
    }, { once: true });
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  initTheme();
  installGlobalErrorHandler();

  let authenticated = false;
  try {
    authenticated = await initKeycloak();
  } catch {
    // Keycloak unavailable
  }

  if (!authenticated) {
    window.location.replace(new URL('index.html', window.location.href).href);
    return;
  }

  // Fill header info from token (fast)
  const info = getUserInfo();
  if (info) {
    setText('profile-name', info.name || info.preferredUsername || 'Mi perfil');
    setText('profile-email', info.email);
    setText('info-name', info.name || '—');
    setText('info-email', info.email || '—');
    setText('info-username', info.preferredUsername || '—');
  }

  // Try to enrich name from API user record
  try {
    const user = await getMe();
    if (user.name) {
      setText('profile-name', user.name.split(' ')[0] ?? user.name);
      setText('info-name', user.name);
    }
    if (user.email) {
      setText('profile-email', user.email);
      setText('info-email', user.email);
    }
  } catch {
    // Non-critical
  }

  // Load passkeys
  await loadPasskeys();
  buildDeleteModal();

  // Wire buttons
  document.getElementById('btn-add-passkey')?.addEventListener('click', registerPasskey);
  document.getElementById('btn-change-password')?.addEventListener('click', changePassword);
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    logout(new URL('index.html', window.location.href).href);
  });

  document.body.classList.add('ready');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
