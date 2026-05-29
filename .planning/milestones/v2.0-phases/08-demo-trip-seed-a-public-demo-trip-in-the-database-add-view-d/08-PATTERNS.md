# Phase 8: OTP + Passkey Campaign — Pattern Map

**Mapped:** 2026-05-24
**Files analyzed:** 13 (7 new, 6 modified)
**Analogs found:** 13 / 13

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `backend/src/routes/auth.ts` | route | request-response | `backend/src/routes/trips.ts` | exact |
| `backend/src/db/queries/otp.ts` | utility/query | CRUD | `backend/src/db/queries/users.ts` | exact |
| `backend/src/types/index.ts` | config | — | self (modify) | exact |
| `backend/src/routes/index.ts` | config | — | self (modify) | exact |
| `backend/src/validation/schemas.ts` | utility | — | self (modify) | exact |
| `backend/src/db/schema.ts` | model | — | self (read-only reference) | exact |
| `backend/src/middleware/auth.ts` | middleware | request-response | self (read-only reference) | exact |
| `backend/src/middleware/user.ts` | middleware | request-response | self (read-only reference) | exact |
| `frontend/src/modules/passkeyCampaign.ts` | module | event-driven | `frontend/src/modules/theme.ts` | role-match |
| `frontend/src/pages/dashboard.ts` | page | request-response | self (modify) | exact |
| `frontend/src/pages/profile.ts` | page | event-driven | self (modify) | exact |
| `backend/src/routes/auth.test.ts` | test | — | `backend/src/index.test.ts` | exact |
| `frontend/src/modules/passkeyCampaign.test.ts` | test | — | `frontend/tests/modules.test.ts` | exact |

---

## Pattern Assignments

### `backend/src/routes/auth.ts` (route, request-response) — NEW

**Analog:** `backend/src/routes/trips.ts`

**Imports pattern** (trips.ts lines 1–43):
```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ensureUserProvisioned } from '../middleware/user';
import type { Env, ContextVariables, ApiResponse } from '../types';
import { OtpVerifySchema } from '../validation/schemas';
import {
  getLatestUnexpiredOtp,
  insertOtp,
  incrementOtpAttempts,
  markOtpUsed,
} from '../db/queries/otp';
```

**Route instantiation + two-phase middleware chain** (trips.ts lines 44–47):
```typescript
const authRoute = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

authRoute.use('*', authMiddleware, ensureUserProvisioned);
```

**Handler — POST with no request body** (trips.ts lines 144–160, adapted):
```typescript
authRoute.post('/otp-request', async (c) => {
  if (!c.env.DATABASE_URL) {
    const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
    return c.json(response, 500);
  }
  const db = getDb(c.env.DATABASE_URL);
  const userId = c.get('dbUserId');
  const email = c.get('user').email;

  if (!email) {
    const response: ApiResponse<never> = { success: false, error: 'no_email' };
    return c.json(response, 422);
  }

  try {
    // OTP logic...
    const response: ApiResponse<never> = { success: true };
    return c.json(response, 201);
  } catch {
    const response: ApiResponse<never> = { success: false, error: 'Failed to send OTP' };
    return c.json(response, 500);
  }
});
```

**Handler — POST with validated body** (trips.ts lines 166–183, adapted):
```typescript
authRoute.post('/otp-verify', zValidator('json', OtpVerifySchema), async (c) => {
  if (!c.env.DATABASE_URL) {
    const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
    return c.json(response, 500);
  }
  const db = getDb(c.env.DATABASE_URL);
  const userId = c.get('dbUserId');
  const { code } = c.req.valid('json');

  try {
    // verify logic...
    const response: ApiResponse<never> = { success: true };
    return c.json(response, 200);
  } catch {
    const response: ApiResponse<never> = { success: false, error: 'Failed to verify OTP' };
    return c.json(response, 500);
  }
});
```

**Non-standard error response shapes** (all other errors have business-logic codes):
```typescript
// 422 — no email on JWT
return c.json({ success: false, error: 'no_email' } satisfies ApiResponse<never>, 422);

// 429 — OTP already pending (retryAfter is extra top-level field alongside ApiResponse shape)
return c.json({ success: false, error: 'otp_pending', retryAfter: secondsRemaining }, 429);

// 429 — max attempts exhausted
return c.json({ success: false, error: 'max_attempts' } satisfies ApiResponse<never>, 429);

// 400 — OTP not found or expired
return c.json({ success: false, error: 'otp_not_found' } satisfies ApiResponse<never>, 400);

// 400 — wrong code (attempts incremented but not exhausted)
return c.json({ success: false, error: 'invalid_code' } satisfies ApiResponse<never>, 400);
```

**Export** (trips.ts line 1017):
```typescript
export default authRoute;
```

---

### `backend/src/db/queries/otp.ts` (utility/query, CRUD) — NEW

**Analog:** `backend/src/db/queries/users.ts`

**Import pattern** (users.ts lines 1–3):
```typescript
import { eq, and, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../index';
import { emailOtpCodes } from '../schema';
```

**Type definitions** (users.ts lines 9–25 pattern):
```typescript
export type OtpRow = typeof emailOtpCodes.$inferSelect;
```

**SELECT query — return single row or undefined** (users.ts lines 35–46 pattern):
```typescript
export async function getLatestUnexpiredOtp(
  db: Db,
  userId: number,
): Promise<OtpRow | undefined> {
  const now = new Date();
  const results = await db
    .select()
    .from(emailOtpCodes)
    .where(
      and(
        eq(emailOtpCodes.user_id, userId),
        gt(emailOtpCodes.expires_at, now),
        isNull(emailOtpCodes.used_at),
      ),
    )
    .orderBy(sql`${emailOtpCodes.created_at} DESC`)
    .limit(1);

  return results[0];
}
```

**INSERT — return inserted row** (users.ts lines 51–65 pattern):
```typescript
export async function insertOtp(
  db: Db,
  userId: number,
  codeHash: string,
  expiresAt: Date,
): Promise<OtpRow> {
  const [created] = await db
    .insert(emailOtpCodes)
    .values({ user_id: userId, code_hash: codeHash, expires_at: expiresAt })
    .returning();

  if (!created) throw new Error('insertOtp: insert returned no rows');
  return created;
}
```

**UPDATE — increment attempts** (users.ts lines 71–83 pattern):
```typescript
export async function incrementOtpAttempts(db: Db, otpId: number): Promise<void> {
  await db
    .update(emailOtpCodes)
    .set({ attempts: sql`${emailOtpCodes.attempts} + 1` })
    .where(eq(emailOtpCodes.id, otpId));
}
```

**UPDATE — mark used** (same pattern):
```typescript
export async function markOtpUsed(db: Db, otpId: number): Promise<void> {
  await db
    .update(emailOtpCodes)
    .set({ used_at: new Date() })
    .where(eq(emailOtpCodes.id, otpId));
}
```

**Re-export from `backend/src/db/index.ts`** (index.ts lines 39–44 pattern):
```typescript
export * from './queries/otp';
```

---

### `backend/src/types/index.ts` (config) — MODIFY

**Existing `Env` interface** (lines 28–35):
```typescript
export interface Env {
  DATABASE_URL: string;
  KEYCLOAK_URL: string;
  KEYCLOAK_REALM: string;
  VALID_AUDIENCES: string;
  KC_ADMIN_CLIENT_ID: string;
  KC_ADMIN_CLIENT_SECRET: string;
}
```

**Add two fields** (same alphabetical-ish style, no surrounding code change):
```typescript
export interface Env {
  DATABASE_URL: string;
  KEYCLOAK_URL: string;
  KEYCLOAK_REALM: string;
  VALID_AUDIENCES: string;
  KC_ADMIN_CLIENT_ID: string;
  KC_ADMIN_CLIENT_SECRET: string;
  OTP_SECRET: string;          // HMAC key for OTP hash (D-07)
  RESEND_API_KEY?: string;     // absent in local dev → Mailpit fallback (D-08)
}
```

---

### `backend/src/routes/index.ts` (config) — MODIFY

**Full file** (lines 1–22):
```typescript
import { Hono } from 'hono';
import type { Env, ContextVariables } from '../types';
import health from './health';
import usersRoute from './users';
import tripsRoute from './trips';
import publicRoute from './public';

const routes = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

routes.route('/health', health);
routes.route('/users', usersRoute);
routes.route('/trips', tripsRoute);
routes.route('/public', publicRoute);

export default routes;
```

**Add one import + one mount** (after the existing mounts, before `export default`):
```typescript
import authRoute from './auth';
// ...
routes.route('/auth', authRoute);
```

---

### `backend/src/validation/schemas.ts` (utility) — MODIFY

**Existing schema pattern** (lines 1–16):
```typescript
import { z } from 'zod';

export const CreateTripSchema = z.object({
  name: z.string().min(1).max(255),
  // ...
});
```

**Add OtpVerifySchema at bottom of file** (same section-separator style):
```typescript
// ---------------------------------------------------------------------------
// OTP schemas
// ---------------------------------------------------------------------------

export const OtpVerifySchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/, 'code must be 6 digits'),
});
```

---

### `backend/src/db/schema.ts` (model) — READ-ONLY REFERENCE

**`emailOtpCodes` table definition** (lines 179–189):
```typescript
export const emailOtpCodes = pgTable('email_otp_codes', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  code_hash: text('code_hash').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  used_at: timestamp('used_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Import as: `import { emailOtpCodes } from '../schema';`

---

### `frontend/src/modules/passkeyCampaign.ts` (module, event-driven) — NEW

**Analog:** `frontend/src/modules/theme.ts` (role-match — exported named function, no default export, no DOM wiring at module load time)

**Import pattern** (keycloak.ts already exports named `keycloak`):
```typescript
import { keycloak } from '@/auth/keycloak';
```

**Exported function** (D-10 through D-15):
```typescript
export function checkPasskeyCampaign(userId: string): void {
  // WebAuthn capability check (D-12)
  if (typeof PublicKeyCredential === 'undefined') return;

  // Per-device cookie check — must include equals sign to avoid userId prefix collisions
  if (document.cookie.includes(`pnk_${userId}=`)) return;

  // Write cookie BEFORE redirect (D-14)
  document.cookie = `pnk_${userId}=1; max-age=2592000; SameSite=Strict`;

  // Redirect to passkey registration AIA (D-15)
  void keycloak.login({
    action: 'webauthn-register-passwordless',
    redirectUri: window.location.href,
  });
}
```

**No default export** — follows theme.ts / countdown.ts named-export convention.

---

### `frontend/src/pages/dashboard.ts` (page, request-response) — MODIFY

**Existing init structure** (lines 192–260). New additions slot into lines 223–253 (the `if (authenticated)` block).

**Add imports** (lines 13–14, extend existing import line):
```typescript
import { initKeycloak, getUserInfo, login, keycloak } from '@/auth/keycloak';
import { checkPasskeyCampaign } from '@/modules/passkeyCampaign';
import { getToken } from '@/auth/keycloak';
```

**Insertion point — top of `if (authenticated)` block** (after line 223):
```typescript
if (authenticated) {
  const info = getUserInfo();
  const webauthnCapable = typeof PublicKeyCredential !== 'undefined';

  if (info) {
    if (webauthnCapable) {
      checkPasskeyCampaign(info.id);  // D-11
    } else {
      buildOtpBanner();               // D-22
    }
  }

  // ... existing getMe() + getMyTrips() calls unchanged
}
```

**OTP modal builder** — copy from profile.ts `buildDeleteModal()` (lines 151–171):
```typescript
function buildOtpModal(): void {
  if (document.getElementById('otp-modal-overlay')) return;  // guard (Pitfall 6 pattern)

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'otp-modal-overlay';
  overlay.setAttribute('hidden', '');

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <h2>Verify your email</h2>
    <p>Check your email for a 6-digit code.</p>
    <input class="otp-input" id="otp-code-input" type="text" inputmode="numeric"
           maxlength="6" pattern="\\d{6}" autocomplete="one-time-code" />
    <p id="otp-error" hidden class="status-msg status-msg--error"></p>
    <div class="form-actions">
      <button class="btn btn-secondary" id="otp-resend-btn" disabled>Resend</button>
      <button class="btn btn-primary" id="otp-verify-btn">Verify</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
```

**OTP banner builder** (D-22):
```typescript
function buildOtpBanner(): void {
  buildOtpModal();

  const banner = document.createElement('div');
  banner.className = 'otp-banner';
  banner.id = 'otp-banner';
  banner.innerHTML = `
    <p>Your device doesn't support passkeys. Verify your email to set a password.</p>
    <button class="btn btn-primary" id="otp-send-btn">Send code</button>
  `;
  document.body.prepend(banner);

  document.getElementById('otp-send-btn')?.addEventListener('click', handleSendOtp);
}
```

**Fetch pattern for OTP endpoints** (same Bearer header as api/client.ts):
```typescript
// POST /api/auth/otp-request (D-23)
async function handleSendOtp(): Promise<void> {
  const token = await getToken();
  const res = await fetch('/api/auth/otp-request', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json() as { success: boolean; error?: string; retryAfter?: number };
  if (res.status === 201) {
    openOtpModal();
  } else if (res.status === 429 && body.retryAfter) {
    // show countdown (D-23: Resend disabled with retryAfter)
  }
}

// POST /api/auth/otp-verify (D-24)
async function handleVerifyOtp(webauthnCapable: boolean): Promise<void> {
  const code = (document.getElementById('otp-code-input') as HTMLInputElement).value;
  const token = await getToken();
  const res = await fetch('/api/auth/otp-verify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (res.ok) {
    closeOtpModal();
    if (!webauthnCapable) {
      // D-21
      await keycloak.login({ action: 'UPDATE_PASSWORD', redirectUri: window.location.href });
    }
  } else {
    const body = await res.json() as { success: boolean; error?: string };
    const errEl = document.getElementById('otp-error');
    if (errEl) { errEl.textContent = body.error ?? 'Error'; errEl.removeAttribute('hidden'); }
  }
}
```

**Modal open/close** — same `hidden` attribute toggle pattern as profile.ts:
```typescript
function openOtpModal(): void {
  document.getElementById('otp-modal-overlay')?.removeAttribute('hidden');
}
function closeOtpModal(): void {
  document.getElementById('otp-modal-overlay')?.setAttribute('hidden', '');
}
```

---

### `frontend/src/pages/profile.ts` (page, event-driven) — MODIFY

**Module-level variable** — add at module top level after imports (D-16):
```typescript
let credentialCount = 0;
```

**Update `loadPasskeys()`** — after line 74 (where `credentials` array is assigned):
```typescript
const credentials = passkeyType?.userCredentialMetadatas.map((m) => m.credential) ?? [];
credentialCount = credentials.length;   // D-16
```

**Update `openDeleteConfirm()`** — insert guard path after freshConfirm clone (lines 185–186), before the existing `freshConfirm.addEventListener` at line 199:
```typescript
freshCancel.addEventListener('click', close, { once: true });

if (credentialCount === 1) {
  // D-17/D-18: last credential guard
  const modalBody = overlay.querySelector('p');
  if (modalBody) {
    modalBody.textContent =
      'You must register another passkey on another device before deleting this one.';
  }
  freshConfirm.setAttribute('hidden', '');

  const guardBtn = document.createElement('button');
  guardBtn.className = 'btn btn-primary';
  guardBtn.setAttribute('data-guard', '');
  guardBtn.textContent = 'Register another passkey first';
  freshConfirm.parentNode?.insertBefore(guardBtn, freshConfirm);
  guardBtn.addEventListener('click', () => {
    // D-19: same call as registerPasskey() (profile.ts lines 122-125)
    keycloak.login({
      action: 'webauthn-register-passwordless',
      redirectUri: window.location.href,
    }).catch(() => { /* non-fatal */ });
  }, { once: true });
} else {
  // existing confirm listener (lines 199-209 unchanged)
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
```

**Reset guard state in `close()`** — add to the existing `close()` function inside `openDeleteConfirm()`:
```typescript
const close = (): void => {
  overlay.setAttribute('hidden', '');
  document.removeEventListener('keydown', onEscape);
  // Reset guard state for next open
  overlay.querySelector('[data-guard]')?.remove();
  const modalBody = overlay.querySelector('p');
  if (modalBody) modalBody.textContent = 'This action cannot be undone.';
};
```

---

### `backend/src/routes/auth.test.ts` (test) — NEW

**Analog:** `backend/src/index.test.ts` (exact — same `app.request()` pattern, same mock env)

**File structure** (index.test.ts lines 1–14):
```typescript
import { describe, it, expect } from 'vitest';
import app from './index';
import type { Env } from './types';

const mockEnv: Env = {
  DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'japan-trip',
  VALID_AUDIENCES: 'japan-trip-frontend',
  KC_ADMIN_CLIENT_ID: 'japan-trip-worker',
  KC_ADMIN_CLIENT_SECRET: 'mock-secret',
  OTP_SECRET: 'aaaabbbbccccddddeeeeffffaaaaabbb',  // 32-char hex for HMAC
  // RESEND_API_KEY absent → Mailpit branch in prod code
};
```

**Auth gate test pattern** (index.test.ts lines 35–42 — copy verbatim, change route):
```typescript
it('POST /api/auth/otp-request without Authorization returns 401', async () => {
  const res = await app.request('/api/auth/otp-request', { method: 'POST' }, mockEnv);
  expect(res.status).toBe(401);
  const body = await res.json() as Record<string, unknown>;
  expect(body.success).toBe(false);
});

it('POST /api/auth/otp-verify without Authorization returns 401', async () => {
  const res = await app.request(
    '/api/auth/otp-verify',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"code":"123456"}' },
    mockEnv,
  );
  expect(res.status).toBe(401);
  const body = await res.json() as Record<string, unknown>;
  expect(body.success).toBe(false);
});
```

**Note:** Full OTP flow tests (with a valid JWT + mock DB) require mocking `verifyJwt` and DB calls. The auth-gate tests above confirm routing and middleware wiring without needing a real JWT.

---

### `frontend/src/modules/passkeyCampaign.test.ts` (test) — NEW

**Analog:** `frontend/tests/modules.test.ts` (exact — same vitest + jsdom + vi.mock pattern)

**File structure** (modules.test.ts lines 1–8):
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
```

**Mock pattern for keycloak** (vi.mock approach used in modules.test.ts):
```typescript
vi.mock('@/auth/keycloak', () => ({
  keycloak: {
    login: vi.fn().mockResolvedValue(undefined),
  },
}));

import { checkPasskeyCampaign } from '@/modules/passkeyCampaign';
import { keycloak } from '@/auth/keycloak';
```

**Test cases — cookie logic + redirect** (PASS-04):
```typescript
describe('checkPasskeyCampaign', () => {
  beforeEach(() => {
    document.cookie = '';  // clear cookies
    vi.clearAllMocks();
    // jsdom has PublicKeyCredential undefined by default
  });

  it('is no-op when WebAuthn not supported', () => {
    // PublicKeyCredential is undefined in jsdom
    checkPasskeyCampaign('user-123');
    expect(keycloak.login).not.toHaveBeenCalled();
  });

  it('is no-op when cookie already set', () => {
    Object.defineProperty(global, 'PublicKeyCredential', { value: {}, configurable: true });
    document.cookie = 'pnk_user-123=1';
    checkPasskeyCampaign('user-123');
    expect(keycloak.login).not.toHaveBeenCalled();
  });

  it('sets cookie and calls keycloak.login when capable and no cookie', () => {
    Object.defineProperty(global, 'PublicKeyCredential', { value: {}, configurable: true });
    checkPasskeyCampaign('user-456');
    expect(document.cookie).toContain('pnk_user-456=');
    expect(keycloak.login).toHaveBeenCalledWith({
      action: 'webauthn-register-passwordless',
      redirectUri: window.location.href,
    });
  });
});
```

---

## Shared Patterns

### Authentication (two-phase middleware chain)
**Source:** `backend/src/routes/trips.ts` lines 28–29, 44–47
**Apply to:** `backend/src/routes/auth.ts`
```typescript
import { authMiddleware } from '../middleware/auth';
import { ensureUserProvisioned } from '../middleware/user';
// ...
authRoute.use('*', authMiddleware, ensureUserProvisioned);
// After this: c.get('user') → KeycloakJwtPayload (has .email?)
//             c.get('dbUserId') → number
```

### API Response Envelope
**Source:** `backend/src/types/index.ts` lines 68–73; applied throughout trips.ts
**Apply to:** All handlers in `backend/src/routes/auth.ts`
```typescript
const response: ApiResponse<never> = { success: true };
return c.json(response, 201);

const response: ApiResponse<never> = { success: false, error: 'error_code' };
return c.json(response, 400);
```

### DATABASE_URL guard
**Source:** `backend/src/routes/trips.ts` lines 145–148 (repeated in every handler)
**Apply to:** Every handler in `backend/src/routes/auth.ts`
```typescript
if (!c.env.DATABASE_URL) {
  const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
  return c.json(response, 500);
}
```

### DB query shape (Drizzle)
**Source:** `backend/src/db/queries/users.ts` lines 35–65
**Apply to:** `backend/src/db/queries/otp.ts`
- `db.select().from(table).where(...).limit(1)` → returns `Row[]`, use `results[0]`
- `db.insert(table).values({...}).returning()` → destructure first element, throw if absent
- `db.update(table).set({...}).where(...)` → no `.returning()` needed for void updates

### Keycloak AIA redirect (frontend)
**Source:** `frontend/src/pages/profile.ts` lines 117–130 (`registerPasskey`), lines 132–145 (`changePassword`)
**Apply to:** `passkeyCampaign.ts`, `dashboard.ts`, `profile.ts` guard button
```typescript
await keycloak.login({
  action: 'webauthn-register-passwordless',  // or 'UPDATE_PASSWORD'
  redirectUri: window.location.href,
});
```

### Modal builder (overlay + `hidden` attribute)
**Source:** `frontend/src/pages/profile.ts` lines 151–171 (`buildDeleteModal`)
**Apply to:** OTP modal in `frontend/src/pages/dashboard.ts`
```typescript
// overlay div with id, hidden attr; modal div with role=dialog, aria-modal=true
// appended to document.body; hidden attr toggled (not display:none)
overlay.setAttribute('hidden', '');   // hide
overlay.removeAttribute('hidden');    // show
```

Guard against double-build:
```typescript
if (document.getElementById('otp-modal-overlay')) return;
```

### Button clone to strip prior listeners
**Source:** `frontend/src/pages/profile.ts` lines 183–186 (inside `openDeleteConfirm`)
**Apply to:** Any button re-wired across multiple modal opens
```typescript
const freshBtn = oldBtn.cloneNode(true) as HTMLButtonElement;
oldBtn.parentNode?.replaceChild(freshBtn, oldBtn);
```

### `showStatus()` error display
**Source:** `frontend/src/pages/profile.ts` lines 26–37
**Apply to:** Inline error display inside OTP modal on dashboard (replicate pattern with `id="otp-error"`)
```typescript
const el = document.getElementById('otp-error');
if (!el) return;
el.textContent = message;
el.className = 'status-msg status-msg--error';
el.removeAttribute('hidden');
```

### Frontend module named export (no default)
**Source:** `frontend/src/modules/theme.ts`, `frontend/src/modules/countdown.ts`
**Apply to:** `frontend/src/modules/passkeyCampaign.ts`
```typescript
export function checkPasskeyCampaign(userId: string): void { ... }
// No: export default ...
```

### DB re-export barrel
**Source:** `backend/src/db/index.ts` lines 39–44
**Apply to:** Add `otp.ts` to the re-export list
```typescript
export * from './queries/otp';
```

---

## No Analog Found

All files have close analogs. No entries.

---

## Metadata

**Analog search scope:** `backend/src/routes/`, `backend/src/middleware/`, `backend/src/types/`, `backend/src/validation/`, `backend/src/db/`, `frontend/src/modules/`, `frontend/src/pages/`, `frontend/src/auth/`
**Files scanned:** 13 source files read directly
**Pattern extraction date:** 2026-05-24
