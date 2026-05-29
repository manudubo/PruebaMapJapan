# Phase 3: Public Sharing - Pattern Map

**Mapped:** 2026-05-05
**Files analyzed:** 8 new/modified files
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `backend/src/db/schema.ts` | model | CRUD | itself (adding column) | exact |
| `backend/src/db/migrations/0002_add_public_slug.sql` | migration | batch | `0001_add_hotel_url_activity_time.sql` | exact |
| `backend/src/db/queries/trips.ts` | service | CRUD | itself (adding query variant) | exact |
| `backend/src/routes/public.ts` | route | request-response | itself (modifying lookup param) | exact |
| `backend/src/validation/schemas.ts` | config | transform | itself (extending existing schema) | exact |
| `frontend/src/types/index.ts` | model | transform | itself (adding field to `ApiTrip`) | exact |
| `frontend/src/api/client.ts` | service | request-response | `getPublicTrip` (lines 297-299) | exact |
| `frontend/src/pages/tripDetail.ts` | page | request-response | itself (auth-conditional + button) | exact |

---

## Pattern Assignments

### 1. Schema column pattern — `backend/src/db/schema.ts`

**Analog:** `backend/src/db/schema.ts` lines 43-56 (trips table) + lines 1-13 (imports)

The existing `trips` table uses `boolean`, `text`, `timestamp`, etc. For `public_slug` add `uuid` from `drizzle-orm/pg-core` and `$defaultFn` with `crypto.randomUUID()`.

**Existing imports block** (lines 1-13):
```typescript
import {
  pgTable,
  serial,
  text,
  varchar,
  boolean,
  integer,
  numeric,
  jsonb,
  timestamp,
  date,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
```
Add `uuid` to this import list.

**Existing trips table** (lines 43-56) — copy the nullable column pattern from `description` (line 49) and `cover_image_url` (line 52):
```typescript
export const trips = pgTable('trips', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),          // <-- nullable, no default: pattern for optional text
  start_date: date('start_date'),
  end_date: date('end_date'),
  cover_image_url: text('cover_image_url'),   // <-- nullable text, no default
  is_public: boolean('is_public').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**New column to add** — pattern to copy:
```typescript
public_slug: uuid('public_slug').$defaultFn(() => crypto.randomUUID()),
```
Insert after `is_public` (line 53), before `created_at`.

**Note:** No `uniqueIndex` analog for trips columns currently, but `users_keycloak_id_idx` (lines 31-33) shows the pattern for a unique index if needed:
```typescript
// In pgTable second arg (table) => ({ ... }):
publicSlugIdx: uniqueIndex('trips_public_slug_idx').on(table.public_slug),
```

---

### 2. Migration pattern — `backend/src/db/migrations/0002_add_public_slug.sql`

**Analog:** `backend/src/db/migrations/0001_add_hotel_url_activity_time.sql` (lines 1-2)

The project uses plain `ALTER TABLE ... ADD COLUMN` SQL migrations hand-written to match the drizzle-kit `out` directory. Migration 0001 is the closest and most recent:

```sql
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS url text;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS time text;
```

**Pattern to copy for new migration:**
```sql
ALTER TABLE trips ADD COLUMN IF NOT EXISTS public_slug uuid DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS trips_public_slug_idx ON trips (public_slug);
```

**Migration workflow** (`backend/package.json` lines 13-14):
- `db:generate` — `drizzle-kit generate` (auto-generates SQL from schema diff)
- `db:migrate` — `drizzle-kit migrate` (applies SQL files in `src/db/migrations/`)
- `db:push` — `drizzle-kit push` (direct push without migration files, used in dev)

The migration file numbering is sequential: `0000_`, `0001_`, `0002_`.

---

### 3. Public route pattern — `backend/src/routes/public.ts`

**Analog:** `backend/src/routes/public.ts` lines 18-55 (the entire existing route)

**Current route** — parameter extraction + query + response shape (lines 18-55):
```typescript
publicRoute.get('/trips/:tripId', async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const tripId = Number(c.req.param('tripId'));

  if (isNaN(tripId)) {
    const response: ApiResponse = { success: false, error: 'Invalid trip id' };
    return c.json(response, 400);
  }

  const result = await db.query.trips.findFirst({
    where: and(eq(trips.id, tripId), eq(trips.is_public, true)),
    with: { /* full nested tree */ },
  });

  if (!result) {
    const response: ApiResponse = { success: false, error: 'Trip not found' };
    return c.json(response, 404);
  }

  const response: ApiResponse = { success: true, data: result };
  return c.json(response);
});
```

**Changes for Phase 3:**
- Route param changes from `:tripId` (integer) to `:slug` (UUID string — no `Number()` conversion needed)
- Query `where` changes from `eq(trips.id, tripId)` to `eq(trips.public_slug, slug)`
- Validation changes from `isNaN(tripId)` to a UUID regex check or simply removing the numeric check

**Pattern for slug validation:**
```typescript
const slug = c.req.param('slug');
if (!slug || !/^[0-9a-f-]{36}$/.test(slug)) {
  const response: ApiResponse = { success: false, error: 'Invalid slug' };
  return c.json(response, 400);
}
```

---

### 4. Frontend API call pattern — `frontend/src/api/client.ts`

**Analog:** `getPublicTrip` (lines 297-299) and `getTrip` (lines 97-99)

**Existing `getPublicTrip`** (lines 297-299):
```typescript
export async function getPublicTrip(tripId: string): Promise<ApiTrip> {
  return request<ApiTrip>(`/public/trips/${tripId}`, { auth: false });
}
```

**Existing `getTrip`** (lines 97-99) for comparison:
```typescript
export async function getTrip(tripId: string): Promise<ApiTrip> {
  return request<ApiTrip>(`/trips/${tripId}`, { auth: true });
}
```

**Pattern for slug-based public call** — rename/update `getPublicTrip` parameter from `tripId` to `slug` and update URL to `/public/trips/${slug}`:
```typescript
export async function getPublicTrip(slug: string): Promise<ApiTrip> {
  return request<ApiTrip>(`/public/trips/${slug}`, { auth: false });
}
```

**`request()` helper** (lines 59-85) — `auth: false` skips the `Authorization` header. The envelope unwrap (`envelope.data`) is the same for both public and authenticated paths.

---

### 5. Auth-conditional render pattern — `frontend/src/pages/tripDetail.ts`

**Analog:** `frontend/src/pages/tripDetail.ts` lines 484-543 (the `init()` function)

The page already has an auth-conditional branch. The `authenticated` flag (line 506) and the fallback to public (lines 514-520) are the gating mechanism:

```typescript
let authenticated = false;
try {
  authenticated = await initKeycloak();
} catch {
  // Continue unauthenticated
}

let trip: ApiTrip | null = null;

if (authenticated && isAuthenticated()) {
  try {
    trip = await getTrip(tripId);
  } catch {
    // Fall through to public
  }
}

if (!trip) {
  try {
    trip = await getPublicTrip(tripId);  // <-- public path
  } catch (err) {
    showError(`No se pudo cargar el viaje: ${(err as Error).message}`);
    document.body.classList.add('ready');
    return;
  }
}
```

**Pattern for hiding owner-only UI** — add after the trip loads (after line 525 `buildDestTabs(trip, destIndex)`):
```typescript
// Show copy-link button only when trip has a public_slug
const copyLinkBtn = document.getElementById('copy-link-btn');
if (copyLinkBtn) {
  if (trip.public_slug) {
    copyLinkBtn.removeAttribute('hidden');
  } else {
    copyLinkBtn.setAttribute('hidden', '');
  }
}

// Hide edit controls when not authenticated (public view)
const editControls = document.querySelectorAll('[data-owner-only]');
editControls.forEach((el) => {
  if (!authenticated) {
    (el as HTMLElement).setAttribute('hidden', '');
  }
});
```

**Existing auth-gate in dashboard** for comparison — `dashboard.ts` lines 175-187 (`setupAuthButtons`) and lines 206-214 (hiding `new-trip-btn`):
```typescript
function setupAuthButtons(authenticated: boolean): void {
  const loginPrompt = document.getElementById('dashboard-login-prompt');
  const tripsGrid = document.getElementById('trips-grid');

  if (!authenticated && loginPrompt && tripsGrid) {
    loginPrompt.removeAttribute('hidden');
    tripsGrid.setAttribute('hidden', '');
  }
}

// Show/hide a button based on auth:
if (authenticated) {
  newTripBtn.removeAttribute('hidden');
  newTripBtn.addEventListener('click', openCreateForm);
} else {
  newTripBtn.setAttribute('hidden', '');
}
```

---

### 6. Button/copy-link pattern — `frontend/src/pages/tripDetail.ts` + HTML analogs

**Closest analog for a non-nav action button:** The `editLink` in `dashboard.ts` (lines 91-95):
```typescript
const editLink = document.createElement('a');
editLink.href = `trip-edit.html?tripId=${trip.id}`;
editLink.className = 'btn btn-secondary';
editLink.style.cssText = 'font-size: 13px; padding: 6px 12px; text-decoration: none;';
editLink.textContent = 'Editar';
```

**Closest analog for a `<button>` with clipboard action:** `dashboard.html` lines 285-291 (the `new-trip-btn`):
```html
<button id="new-trip-btn" class="btn btn-primary" hidden>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
  Nuevo viaje
</button>
```

**Pattern for the copy-link button** — add to trip.html in the header area (analogous to `trip-edit.html` lines 238-243 `.dashboard-actions`):
```html
<button id="copy-link-btn" class="btn btn-secondary" hidden>
  Copiar enlace público
</button>
```

**JS handler pattern** — use `navigator.clipboard.writeText`, feedback via button text swap (no existing analog; use the pattern established by `showError` for transient feedback):
```typescript
const copyLinkBtn = document.getElementById('copy-link-btn');
copyLinkBtn?.addEventListener('click', async () => {
  const url = `${window.location.origin}/trip.html?tripId=${trip.public_slug}`;
  await navigator.clipboard.writeText(url);
  copyLinkBtn.textContent = '¡Copiado!';
  setTimeout(() => { copyLinkBtn.textContent = 'Copiar enlace público'; }, 2000);
});
```

---

### 7. ApiTrip type — `frontend/src/types/index.ts`

**Current `ApiTrip` definition** (lines 126-136):
```typescript
export interface ApiTrip {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  cover_image_url: string | null;
  is_public: boolean;
  destinations: ApiDestination[];
}
```

**Status:** `is_public: boolean` is present. `public_slug` is **NOT** present.

**Field to add:**
```typescript
public_slug: string | null;
```
Insert after `is_public` (line 134), before `destinations`.

---

### 8. Zod schema pattern — `backend/src/validation/schemas.ts`

**Analog:** `CreateTripSchema` (lines 7-14) and `UpdateTripSchema` (line 16)

`public_slug` is auto-generated by the DB (`$defaultFn`) — it should NOT be in `CreateTripSchema` or `UpdateTripSchema` as a client-settable field.

No schema change is needed for the slug itself. The only schema change is that `UpdateTripSchema` (derived via `.partial()`) already passes through any fields defined in `CreateTripSchema`. If `is_public` toggling is in scope, it is already covered (line 13: `is_public: z.boolean().optional().default(false)`).

**Existing schema** (lines 7-16):
```typescript
export const CreateTripSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  start_date: z.string().date().nullable().optional(),
  end_date: z.string().date().nullable().optional(),
  cover_image_url: z.string().url().nullable().optional(),
  is_public: z.boolean().optional().default(false),
});

export const UpdateTripSchema = CreateTripSchema.partial();
```

---

## Shared Patterns

### Hidden-until-needed UI element
**Source:** `frontend/dashboard.ts` lines 206-214 / `frontend/dashboard.html` line 285
**Apply to:** copy-link button in `tripDetail.ts`
```typescript
// Start hidden in HTML: <button id="copy-link-btn" ... hidden>
// Reveal conditionally:
btn.removeAttribute('hidden');
// Hide again:
btn.setAttribute('hidden', '');
```

### ApiResponse envelope
**Source:** `backend/src/routes/public.ts` lines 22-24, 48-50, 53-54
**Apply to:** any new route handlers
```typescript
const response: ApiResponse = { success: false, error: 'Invalid ...' };
return c.json(response, 400);
// ...
const response: ApiResponse = { success: true, data: result };
return c.json(response);
```

### Drizzle relational query with nested `with`
**Source:** `backend/src/routes/public.ts` lines 28-46
**Apply to:** `getTripBySlug` query function in `trips.ts`
```typescript
const result = await db.query.trips.findFirst({
  where: and(eq(trips.public_slug, slug), eq(trips.is_public, true)),
  with: {
    destinations: {
      orderBy: (d, { asc }) => [asc(d.order_index)],
      with: {
        hotel: true,
        days: {
          orderBy: (d, { asc }) => [asc(d.order_index)],
          with: {
            activities: {
              orderBy: (a, { asc }) => [asc(a.order_index)],
            },
          },
        },
      },
    },
  },
});
```

### CSS button classes
**Source:** `frontend/trip-edit.html` lines 58-98 / `frontend/dashboard.html` lines 58-98
**Apply to:** copy-link button HTML
```
.btn           — base: inline-flex, gap, padding, border-radius, font
.btn-secondary — white bg, border, inherit text color
.btn-primary   — accent bg (#0071e3), white text
```

---

## No Analog Found

None. All files have direct analogs in the codebase.

---

## Key Observations for Planner

1. **`public_slug` is absent from `ApiTrip`** — must be added to `frontend/src/types/index.ts` before any frontend work.

2. **Public route currently uses integer `tripId`** — the route param name, type extraction (`Number(...)`), and `isNaN` guard all need updating when switching to UUID slug.

3. **`getPublicTrip` in `client.ts`** currently receives `tripId: string` and hits `/public/trips/${tripId}`. The function signature rename to `slug` is cosmetic; the URL change is the functional change.

4. **`tripDetail.ts` already has the auth-conditional skeleton** (lines 496-520) — the copy-link button wiring hooks into the existing `authenticated` variable already in scope at `init()` time.

5. **Migration workflow:** `db:generate` creates SQL from schema diff; `db:migrate` applies it. `db:push` skips files. For Phase 3, `db:generate` then `db:migrate` is the correct path (preserves migration history). The generated file will land in `src/db/migrations/0002_*.sql`.

6. **`$defaultFn` vs SQL `DEFAULT`**: Drizzle's `$defaultFn(() => crypto.randomUUID())` runs in application code (Cloudflare Workers has `crypto` available globally). The migration SQL uses `gen_random_uuid()` (PostgreSQL built-in) which is equivalent and correct for the DB-side default.

---

## Metadata

**Analog search scope:** `backend/src/db/`, `backend/src/routes/`, `backend/src/validation/`, `frontend/src/`, `frontend/*.html`
**Files scanned:** 14
**Pattern extraction date:** 2026-05-05
