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

const KEYCLOAK_URL = import.meta.env['VITE_KEYCLOAK_URL'] as string ?? 'http://localhost:8080';
const KEYCLOAK_REALM = import.meta.env['VITE_KEYCLOAK_REALM'] as string ?? 'japan-trip';

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

    if (credentials.length === 0) {
      list.innerHTML =
        '<li style="font-size:14px;color:var(--text-secondary,#515154);padding:8px 0;">You don\'t have any passkeys registered yet.</li>';
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
      '<li style="font-size:14px;color:var(--text-secondary,#515154);padding:8px 0;">Could not load passkey list.</li>';
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

// ---------------------------------------------------------------------------
// Delete passkey modal
// ---------------------------------------------------------------------------

function buildDeleteModal(): void {
  const style = document.createElement('style');
  style.textContent = `
    .overlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:2000;
      display:flex; align-items:center; justify-content:center; padding:16px;
      backdrop-filter:blur(4px); }
    .overlay[hidden] { display:none; }
    .modal { background:var(--bg-primary,#f5f5f7); border-radius:4px; padding:28px;
      width:100%; max-width:480px; box-shadow:0 24px 64px rgba(0,0,0,0.2); }
    .modal h2 { margin:0 0 20px; font-size:20px; font-weight:600; }
    .form-actions { display:flex; justify-content:flex-end; gap:12px; margin-top:24px; }
  `;
  document.head.appendChild(style);

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
  };
  const onEscape = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onEscape);

  freshCancel.addEventListener('click', close, { once: true });

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

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  initTheme();

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

  // Change-password link → Keycloak account page
  const pwLink = document.getElementById('btn-change-password') as HTMLAnchorElement | null;
  if (pwLink) {
    pwLink.href = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/account/password`;
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
