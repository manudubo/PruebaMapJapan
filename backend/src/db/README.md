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
