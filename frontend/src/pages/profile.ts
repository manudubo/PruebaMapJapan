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

interface CredentialInfo {
  id: string;
  type: string;
  userLabel?: string;
  createdDate?: number;
}

async function loadPasskeys(): Promise<void> {
  const list = document.getElementById('passkey-list');
  if (!list) return;

  try {
    const token = keycloak.token;
    const res = await fetch(
      `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/account/credentials?type=webauthn-passwordless`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const credentials: CredentialInfo[] = await res.json() as CredentialInfo[];
    const webauthn = credentials.filter((c) => c.type === 'webauthn-passwordless');

    if (webauthn.length === 0) {
      list.innerHTML =
        '<li style="font-size:14px;color:var(--text-secondary,#515154);padding:8px 0;">No tenés passkeys registrados todavía.</li>';
      return;
    }

    list.innerHTML = webauthn
      .map((c) => {
        const label = c.userLabel ?? 'Passkey';
        const created = c.createdDate
          ? new Date(c.createdDate).toLocaleDateString('es-ES', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
          : '';
        return `
        <li class="passkey-item">
          <div class="passkey-info">
            <span class="passkey-name">${label}</span>
            ${created ? `<span class="passkey-meta">Registrado: ${created}</span>` : ''}
          </div>
        </li>`;
      })
      .join('');
  } catch {
    list.innerHTML =
      '<li style="font-size:14px;color:var(--text-secondary,#515154);padding:8px 0;">No se pudo cargar la lista de passkeys.</li>';
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
    showStatus('passkey-status', 'Error al iniciar el registro de passkey.', 'error');
    if (btn) btn.disabled = false;
  }
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
