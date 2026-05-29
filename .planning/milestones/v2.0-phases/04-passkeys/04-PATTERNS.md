# Phase 4: Passkeys — Pattern Map

**Mapped:** 2026-05-07
**Files analyzed:** 5
**Analogs found:** 2 / 5 (3 config files have no meaningful analog)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `keycloak/docker-compose.yml` | config | n/a | none | no analog |
| `keycloak/Dockerfile` | config | n/a | none | no analog |
| `keycloak/realm-export.json` | config | n/a | none | no analog |
| `frontend/package.json` | config | n/a | none | no analog |
| `frontend/src/pages/profile.ts` | page controller | request-response | `frontend/src/pages/trip-edit/destinations.ts` | role-match |

---

## Pattern Assignments

### `frontend/src/pages/profile.ts` (page controller, request-response)

**Analog:** `frontend/src/pages/trip-edit/destinations.ts`

This file contains all five code changes for Phase 4. Patterns are grouped by the three distinct
change areas: (1) string fixes, (2) delete button in list render, (3) delete confirm modal.

---

#### Change 1 — D-04: Type filter fix (line 66)

**Current (WRONG):**
```typescript
// profile.ts line 57 — fetch also uses wrong type
`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/account/credentials?type=webauthn`
// profile.ts line 66
const webauthn = credentials.filter((c) => c.type === 'webauthn');
```

**Target (CORRECT):**
```typescript
// Both the ?type= query param AND the .filter() must use 'webauthn-passwordless'
`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/account/credentials?type=webauthn-passwordless`
const webauthn = credentials.filter((c) => c.type === 'webauthn-passwordless');
```

---

#### Change 2 — D-03: Registration action string fix (line 105)

**Current (WRONG):**
```typescript
// profile.ts line 104-107
await keycloak.login({
  action: 'webauthn-register',
  redirectUri: window.location.href,
});
```

**Target (CORRECT):**
```typescript
await keycloak.login({
  action: 'webauthn-register-passwordless',
  redirectUri: window.location.href,
});
```

---

#### Change 3 — D-05: Delete button per passkey row (inside `loadPasskeys()`)

**Existing list render pattern** (profile.ts lines 74-92):
```typescript
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
```

**Target — add `data-credential-id` and delete button to each `<li>`:**
```typescript
return `
<li class="passkey-item" data-credential-id="${c.id}">
  <div class="passkey-info">
    <span class="passkey-name">${label}</span>
    ${created ? `<span class="passkey-meta">Registrado: ${created}</span>` : ''}
  </div>
  <button class="btn btn-danger" type="button" data-credential-id="${c.id}" data-passkey-delete>
    Eliminar
  </button>
</li>`;
```

After `list.innerHTML = ...`, wire all delete buttons (analog: destinations.ts uses `delBtn.addEventListener` per rendered row):
```typescript
list.querySelectorAll<HTMLButtonElement>('[data-passkey-delete]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const credId = btn.dataset.credentialId;
    if (credId) openDeleteConfirm(credId);
  });
});
```

---

#### Change 4 — D-05: Dynamic confirm modal (new function `buildDeleteModal()`)

**Pattern source:** `frontend/src/pages/trip-edit/destinations.ts` lines 31-45 (dynamic overlay build).

`profile.html` has **no** `.overlay`/`.modal` CSS — the CSS block must be injected dynamically by
profile.ts, same as how destinations.ts appends its edit modal. The overlay CSS lives in
`frontend/trip-edit.html` lines 92-119 but must be recreated inline here.

```typescript
// Call once at init time (like destinations.ts buildModal())
function buildDeleteModal(): void {
  // Inject overlay CSS into <head> if .overlay class not present
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
    <h2>¿Eliminar passkey?</h2>
    <p>Esta acción no se puede deshacer.</p>
    <p class="status-msg status-msg--error" id="passkey-delete-error" hidden></p>
    <div class="form-actions">
      <button class="btn btn-secondary" id="passkey-delete-cancel">Cancelar</button>
      <button class="btn btn-danger" id="passkey-delete-confirm">Eliminar</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
```

---

#### Change 5 — D-05: Delete confirm wiring (new function `openDeleteConfirm()`)

**Pattern source:** `frontend/src/pages/trip-edit/destinations.ts` lines 331-385
(`openConfirmDelete` function — reads from static overlay, clones buttons to strip listeners,
uses `{ once: true }` on confirm, calls `close()` on cancel/escape).

Key adaptation: the DELETE call uses `keycloak.token` as Bearer (same pattern as `loadPasskeys()`
lines 55-60), not a custom `deleteDestination()` API client function.

```typescript
async function openDeleteConfirm(credentialId: string): Promise<void> {
  const overlay = document.getElementById('passkey-delete-overlay');
  const errorEl = document.getElementById('passkey-delete-error');
  const cancelBtn = document.getElementById('passkey-delete-cancel');
  const confirmBtn = document.getElementById('passkey-delete-confirm');

  if (!overlay || !cancelBtn || !confirmBtn) return;

  if (errorEl) errorEl.setAttribute('hidden', '');
  overlay.removeAttribute('hidden');

  // Clone buttons to strip any prior event listeners (destinations.ts pattern, line 348-352)
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

  freshConfirm.addEventListener('click', async () => {
    freshConfirm.disabled = true;
    freshConfirm.textContent = 'Eliminando…';
    const freshError = document.getElementById('passkey-delete-error');
    if (freshError) freshError.setAttribute('hidden', '');

    try {
      // Bearer token pattern from loadPasskeys() lines 55-60
      const res = await fetch(
        `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/account/credentials/${credentialId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${keycloak.token}` },
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      close();
      // Refresh list (same pattern as renderList() call in destinations.ts line 375)
      await loadPasskeys();
      showStatus('passkey-status', 'Passkey eliminada correctamente.', 'success');
    } catch {
      if (freshError) {
        freshError.textContent = 'No se pudo eliminar. Intentá de nuevo.';
        freshError.removeAttribute('hidden');
      }
      freshConfirm.disabled = false;
      freshConfirm.textContent = 'Eliminar';
    }
  }, { once: true });
}
```

**In-file helpers to reuse (no import needed):**
- `showStatus('passkey-status', msg, type)` — profile.ts lines 26-37
- `keycloak.token` — profile.ts line 55 (Bearer token for fetch calls)

**In `init()`, add `buildDeleteModal()` call** after `loadPasskeys()` (line 165), before button wiring.

---

## Shared Patterns

### Bearer token fetch
**Source:** `frontend/src/pages/profile.ts` lines 55-60
**Apply to:** DELETE call in `openDeleteConfirm()`
```typescript
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${keycloak.token}` },
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
```

### Status feedback
**Source:** `frontend/src/pages/profile.ts` lines 26-37 (`showStatus`)
**Apply to:** Delete success/error (target element ID: `'passkey-status'`)
```typescript
showStatus('passkey-status', 'Passkey eliminada correctamente.', 'success');
```

### Button clone pattern (strips prior listeners)
**Source:** `frontend/src/pages/trip-edit/destinations.ts` lines 348-352
**Apply to:** `openDeleteConfirm()` cancel and confirm buttons
```typescript
const fresh = btn.cloneNode(true) as HTMLButtonElement;
btn.parentNode?.replaceChild(fresh, btn);
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `keycloak/docker-compose.yml` | config | n/a | Config file — surgical string edits, no code analog |
| `keycloak/Dockerfile` | config | n/a | Config file — surgical string edits, no code analog |
| `keycloak/realm-export.json` | config | n/a | JSON config — surgical value edit, no code analog |
| `frontend/package.json` | config | n/a | Package manifest — version bump, no code analog |

### Config file change targets (exact locations)

**`keycloak/docker-compose.yml`** — 3 changes:
- Line 21: `quay.io/keycloak/keycloak:25.0` → `quay.io/keycloak/keycloak:26.6.1`
- Line 23: `KEYCLOAK_ADMIN: admin` → `KC_BOOTSTRAP_ADMIN_USERNAME: admin`
- Line 24: `KEYCLOAK_ADMIN_PASSWORD: admin` → `KC_BOOTSTRAP_ADMIN_PASSWORD: admin`

**`keycloak/Dockerfile`** — 2 changes:
- Line 1: `FROM quay.io/keycloak/keycloak:25.0 AS builder` → `FROM quay.io/keycloak/keycloak:26.6.1 AS builder`
- Line 5: `FROM quay.io/keycloak/keycloak:25.0` → `FROM quay.io/keycloak/keycloak:26.6.1`

**`keycloak/realm-export.json`** — 1 change:
- Line 42: `"webAuthnPolicyPasswordlessRpId": ""` → `"webAuthnPolicyPasswordlessRpId": "localhost"`

**`frontend/package.json`** — 1 change:
- Line 25: `"keycloak-js": "^25.0.0"` → `"keycloak-js": "^26.0.0"`
- After editing: run `npm install` then `npm run typecheck`

---

## Critical Notes for Planner

1. **`profile.html` has no `.overlay`/`.modal` CSS.** The planner must inject these styles dynamically
   in `buildDeleteModal()` via `document.createElement('style')`. Do NOT add a static overlay `<div>`
   to profile.html — use the dynamic build pattern from destinations.ts lines 31-45.

2. **Re-import after realm-export.json change requires volume wipe.** The plan must include
   `docker compose down -v && docker compose up` — a simple restart skips realm re-import.

3. **Dockerfile bump has no effect on local dev** — docker-compose.yml pulls the official image
   directly, not via the Dockerfile. The Dockerfile bump is correct for completeness but does not
   affect `docker compose up` behaviour.

4. **DELETE `/account/credentials/{id}` is deprecated in KC 26** (not removed). Add a `// TODO`
   comment in `openDeleteConfirm()` noting the AIA alternative
   (`keycloak.login({ action: 'delete_credential:{id}' })`) for future KC upgrades.

5. **`loadPasskeys()` must be called after the delete succeeds** to refresh the list (not DOM
   manipulation on the existing list). This matches the `renderList()` call pattern in destinations.ts
   line 375.

---

## Metadata

**Analog search scope:** `frontend/src/pages/`, `frontend/`, `keycloak/`
**Files scanned:** 10
**Pattern extraction date:** 2026-05-07
