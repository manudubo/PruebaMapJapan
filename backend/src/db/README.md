# Database — Setup & Operations

This project uses [Drizzle ORM](https://orm.drizzle.team/) backed by [Neon](https://neon.tech/) (serverless PostgreSQL).

---

## 1. Setting up Neon (free tier)

1. Go to [neon.tech](https://neon.tech/) and create a free account.
2. Click **New Project**. Choose a region close to your Cloudflare Workers deployment (e.g. `AWS / us-east-1`).
3. Neon creates a default database called `neondb` and a `main` branch automatically.
4. Open the project dashboard → **Connection Details** → select **Node.js** as the driver.
5. Copy the connection string. It looks like:

   ```
   postgres://user:password@ep-xxxx-xxxx.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```

6. Paste it as `DATABASE_URL` in your `.dev.vars` file (local development) and as a secret in Cloudflare:

   ```bash
   wrangler secret put DATABASE_URL
   ```

---

## 2. Running migrations

Migrations live in `backend/src/db/migrations/`. The initial migration (`0000_initial.sql`) creates all tables.

```bash
# From the backend directory:
DATABASE_URL=postgres://... npm run db:migrate
```

Or generate new migrations after schema changes:

```bash
npm run db:generate   # generates SQL from schema.ts
npm run db:migrate    # applies pending migrations
```

The npm scripts are wired up in `backend/package.json` via `drizzle-kit`.

> **Always `db:migrate`, never `db:push` / `drizzle-kit push`** on a database you
> keep. `push` diffs `schema.ts` against the database: it never creates the SQL
> functions and triggers from the migrations (`otp_issue()`, the BIZ-07 date
> triggers), skips the data clean-up the migrations do first, and writes no
> migration journal. The Worker then answers `503 schema_not_migrated`, and a
> later `db:migrate` re-runs every migration and fails part-way.

### Pre-flight checks

```bash
DATABASE_URL=postgres://... npm run db:preflight            # emails redacted
DATABASE_URL=postgres://... npm run db:preflight -- --show-emails
```

Exit 0 = safe to migrate, 1 = a blocker was found (printed with the fix),
2 = `DATABASE_URL` unset or unreachable. The deploy workflow runs it before
`db:migrate`. It detects:

- **Duplicate emails** (blocks 0005, the unique index on `lower(email)`). The
  same check as plain SQL:
  ```sql
  SELECT lower(email) AS email, array_agg(id ORDER BY id) AS user_ids
    FROM users WHERE email <> ''
   GROUP BY lower(email) HAVING count(*) > 1;
  ```
  Keep one account per email: move the other account's trips
  (`UPDATE trips SET user_id = <kept> WHERE user_id = <other>`), delete the
  other user, re-run.
- **A database created with `drizzle-kit push`** (see below).

### Databases created with `drizzle-kit push`

Such a database has the app tables but no `drizzle.__drizzle_migrations` rows,
and its schema differs in details from the migrated one. Do not try to fake the
journal. Rebuild it from the migrations and copy the data across:

1. Take a backup (on Neon: **Branches → Create branch** from the current one).
2. Create an empty database (or Neon branch/database) and run
   `npm run db:migrate` against it.
3. Copy the data only:
   `pg_dump --data-only --exclude-schema=drizzle "$OLD_URL" | psql "$NEW_URL"`.
   If a row is rejected by a CHECK or a BIZ-07 trigger, fix that row in the old
   database and repeat.
4. Point the Worker (`wrangler secret put DATABASE_URL`) and the
   `MIGRATION_DATABASE_URL` GitHub secret at the new database.

### 0006 and swapped coordinates (data loss, by design)

Migration 0006 adds lat/lng range CHECKs. Rows with an out-of-range value get
**both** coordinates set to NULL first; a row whose lat and lng were simply
entered the wrong way round (e.g. lat 139.7, lng 35.6 for Tokyo) loses its
pin rather than being swapped back. Automatic swapping is not safe: when both
values are within ±90 a swap cannot be detected, and swapping only the
detectable rows would silently "fix" some pins and not others.

Before migrating a database that predates 0006, list the candidates and fix
them by hand if you want to keep them:

```sql
SELECT 'activities' AS t, id, lat, lng FROM activities
 WHERE NOT lat BETWEEN -90 AND 90 AND lat BETWEEN -180 AND 180 AND lng BETWEEN -90 AND 90
UNION ALL
SELECT 'destinations', id, lat, lng FROM destinations
 WHERE NOT lat BETWEEN -90 AND 90 AND lat BETWEEN -180 AND 180 AND lng BETWEEN -90 AND 90
UNION ALL
SELECT 'hotels', id, lat, lng FROM hotels
 WHERE NOT lat BETWEEN -90 AND 90 AND lat BETWEEN -180 AND 180 AND lng BETWEEN -90 AND 90;
-- then, per row you confirm:  UPDATE <t> SET lat = lng, lng = lat WHERE id = <id>;
```

### Schema guard

On its first DB request each Worker isolate checks (one catalog query, cached)
that the objects from 0007–0009 exist. If not, every DB route answers
`503 {"code":"schema_not_migrated"}` and the log names what is missing.
`GET /api/health/ready` returns the same verdict (`200 {"status":"ready"}` or
`503`) for probes; `GET /api/health` never touches the database.

---

## 3. Running seed data

The seed script creates a demo user and the full Japan 2026 itinerary. It is **idempotent** — safe to run multiple times.

```bash
# From the repository root:
DATABASE_URL=postgres://... npx tsx backend/src/db/seed.ts
```

Or add a convenience script to `backend/package.json`:

```json
"db:seed": "tsx src/db/seed.ts"
```

Then run:

```bash
DATABASE_URL=postgres://... npm run db:seed
```

---

## 4. Drizzle Studio

Drizzle Studio is a browser-based GUI for browsing and editing your data.

```bash
DATABASE_URL=postgres://... npm run db:studio
```

This requires the `db:studio` script in `package.json`:

```json
"db:studio": "drizzle-kit studio"
```

Open [https://local.drizzle.studio](https://local.drizzle.studio) in your browser once the command is running.

---

## 5. Neon connection string format

```
postgres://<user>:<password>@<host>/<database>?sslmode=require
```

| Part | Example |
|------|---------|
| `user` | `neondb_owner` |
| `password` | `abc123xyz` (auto-generated) |
| `host` | `ep-cool-name-12345678.us-east-1.aws.neon.tech` |
| `database` | `neondb` |

The `?sslmode=require` query parameter is mandatory for Neon connections.

> **Tip:** Neon also offers a *pooled* connection string (ending in `-pooler`). Use the pooled URL for serverless environments (Cloudflare Workers), and the direct URL for migrations and seed scripts.
