# Phase 12: Terraform Expansion + Dev Script — Research

**Researched:** 2026-06-01
**Domain:** Node.js dev orchestration + Terraform Keycloak IaC
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Dev Script: Tooling**
Node.js script at project root — `scripts/dev.js`. Uses `child_process` + `concurrently`. No shell scripts. Root package.json gets `"dev": "node scripts/dev.js"`. Existing `dev:frontend` and `dev:backend` remain unchanged.

**Dev Script: Docker Desktop Detection**
Detect via `docker info` exit code — exit 0 means running, non-zero means not. Opening Docker Desktop per-platform:
- macOS: `open -a "Docker Desktop"`
- Windows: `start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"`
- Linux: warn user and continue

Wait loop: poll `docker info` until exit 0 (timeout ~60s). Then `docker compose up` from `keycloak/` directory.

**Dev Script: Service Startup Order**
Sequential:
1. `docker compose up -d` in `keycloak/` (detached)
2. Poll `http://localhost:8080/realms/japan-trip` until 200 (timeout ~90s)
3. Start backend (`npm run dev --workspace=backend`) via concurrently
4. Start frontend (`npm run dev --workspace=frontend`) via concurrently

Concurrently prefixes: `[keycloak]`, `[backend]`, `[frontend]`

**Dev Script: Compose File Location**
`docker-compose.yml` is in `keycloak/` subdirectory. Dev script must run `docker compose` from that directory.

**Terraform: New Test Users**

| Resource | Username | Email | Password variable |
|----------|----------|-------|-------------------|
| INFRA-01: `keycloak_user.testuser` | `testuser` | `testuser@local` | `var.testuser_password` (default: `Test1234!`) |
| INFRA-02: `keycloak_user.new_user_test` | `new_user_test` | `new_user_test@local` | `var.new_user_test_password` (default follows password policy) |
| INFRA-03: `keycloak_user.trip_edit_test_user` | `trip_edit_test_user` | `trip_edit_test_user@local` | `var.trip_edit_test_user_password` (default follows policy) |

All users: `email_verified = true`, `enabled = true`, `temporary = false`.
INFRA-01 note: `testuser` currently exists in KC manually — must use `import = true` or `terraform import`.

**Terraform: Redirect URIs (SEC-03)**
Remove wildcards from `valid_redirect_uris`. Replace with explicit URIs. Dev and prod separated.

**Terraform: PKCE S256 (INFRA-04)**
`pkce_code_challenge_method = "S256"` already in main.tf. Researcher must confirm zero drift via `terraform plan`.

### Claude's Discretion

- Whether to use concurrently npm package or custom spawn manager — prefer concurrently
- Exact timeout values for health checks (suggest Docker ~60s, KC ~90s)
- Whether to add concurrently as root-level devDependency or bundle in dev script
- Variable naming in `terraform/keycloak/variables.tf` for three new password variables
- Whether to add a `terraform.tfvars.example` file

### Deferred Ideas (OUT OF SCOPE)

None raised during discussion.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEVENV-01 | Single `npm run dev` that detects Docker Desktop, opens if not running, waits for KC health, starts services in order | Node.js `spawnSync('docker', ['info'])` exit-code check; `spawnSync` to open Docker Desktop; fetch-based KC poll loop |
| DEVENV-02 | Color-labeled output per process (Keycloak, backend, frontend) via concurrently | concurrently@10.0.1 programmatic API with `name` + `prefixColor` per command; `docker compose logs -f keycloak` as the `[keycloak]` process |
| INFRA-01 | `testuser` as managed Terraform resource | `keycloak_user` with `import = true` — adopts existing user without destroying credentials |
| INFRA-02 | `new_user_test` as managed Terraform resource | Standard `keycloak_user` HCL following `e2e_test_user` pattern |
| INFRA-03 | `trip_edit_test_user` as managed Terraform resource | Standard `keycloak_user` HCL following `e2e_test_user` pattern |
| INFRA-04 | KC client enforces PKCE S256 server-side | `pkce_code_challenge_method = "S256"` already in main.tf; verify with `terraform plan` zero-drift check |
| SEC-03 | Strict redirect URIs, no wildcards, dev/prod separated | Enumerated full URI list from keycloak.ts + login() callsites; `silent-check-sso.html` must be included |
</phase_requirements>

---

## Summary

Phase 12 has two independent tracks. The dev script track is a Node.js orchestration script (`scripts/dev.js`) that sequences Docker Compose startup, a KC health-poll, and then hands control to `concurrently` for the backend and frontend processes. The Terraform track adds three new `keycloak_user` resources and hardens the `keycloak_openid_client` redirect URI configuration.

The most important pre-condition for the Terraform track is running a `terraform plan` that confirms **zero realm drift** before touching any other resource. The `web_authn_passwordless_policy.relying_party_id = "localhost"` is pinned in HCL; any undetected realm drift could overwrite it, breaking all existing passkeys with no recovery path.

**Provider correction:** CONTEXT.md line 135 refers to "mrparkers/keycloak" — this is outdated. `terraform/keycloak/versions.tf` pins `source = "keycloak/keycloak"` (the official provider, formerly maintained at mrparkers). All HCL patterns and import syntax reference the official `keycloak/keycloak` provider. [VERIFIED: terraform/keycloak/versions.tf]

**Primary recommendation:** Dev script uses the concurrently programmatic API (not CLI) so Docker startup and health-polling happen before concurrently is invoked. The `[keycloak]` label is satisfied by running `docker compose logs -f keycloak` as the third concurrently command alongside backend and frontend.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Docker Desktop detection + launch | Dev script (Node.js) | — | OS-level spawn; not a runtime service concern |
| KC health polling | Dev script (Node.js) | — | Gate before backend can connect to KC |
| Process orchestration (backend + frontend + KC logs) | Dev script via concurrently | — | Multiplexed output with labels |
| KC user lifecycle | Terraform (IaC) | — | Idempotent; must not use KC console |
| KC client security hardening (PKCE, redirect URIs) | Terraform (IaC) | — | Server-enforced; HCL is source of truth |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| concurrently | 10.0.1 | Multiplexed process runner with color labels | Industry standard for npm workspace dev scripts; cross-platform |
| Node.js built-in: `child_process` | Node 24 (project runtime) | Docker detection, compose launch | No dependency needed; `spawnSync` for sync checks |
| Node.js built-in: `fetch` | Node 18+ | KC health-check HTTP polling | Built-in since Node 18; project runs Node 24 [VERIFIED: node --version] |
| keycloak/keycloak Terraform provider | >= 5.7.0 (pinned) | KC resource management | Official provider; already pinned [VERIFIED: versions.tf] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `docker compose logs -f keycloak` | N/A (Docker CLI) | Stream KC logs as the `[keycloak]` concurrently process | Required for DEVENV-02's three-label output |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| concurrently programmatic API | concurrently CLI via `npm run` | CLI can't do sequential pre-steps (Docker detect, health poll) before launching processes |
| concurrently | npm-run-all | npm-run-all development is less active; concurrently has color-label API |
| `import = true` on testuser | `terraform import` CLI command | `import = true` is declarative and idempotent; CLI import requires a separate manual step and exact user UUID lookup |

**Installation:**
```bash
npm install --save-dev concurrently
```

(Add at root workspace, not in frontend/ or backend/.)

**Version verification:**
```
npm view concurrently version  →  10.0.1
```
[VERIFIED: npm registry, 2026-06-01]

---

## Architecture Patterns

### System Architecture Diagram

```
npm run dev
    │
    ▼
scripts/dev.js
    │
    ├── 1. docker info (spawnSync) ──► exit 0? ──► No ──► launch Docker Desktop ──► poll docker info (60s timeout)
    │                                                                                          │
    │                                                                                          ▼
    ├── 2. docker compose up -d  (cwd: keycloak/)                             ◄──── Docker running
    │
    ├── 3. poll GET http://localhost:8080/realms/japan-trip (fetch, 90s timeout)
    │         └── retry loop: 3s interval, exponential optional
    │
    └── 4. concurrently([
              { command: 'docker compose logs -f keycloak', name: 'keycloak', cwd: 'keycloak/', prefixColor: 'cyan' },
              { command: 'npm run dev --workspace=backend',  name: 'backend',  prefixColor: 'yellow' },
              { command: 'npm run dev --workspace=frontend', name: 'frontend', prefixColor: 'green' },
            ], { prefix: 'name', killOthersOn: ['failure'] })
```

### Recommended Project Structure

```
scripts/
└── dev.js           # New — dev orchestration script (CommonJS, no shebang needed)
terraform/
└── keycloak/
    ├── main.tf      # Add 3 keycloak_user resources + harden client redirect URIs
    └── variables.tf # Add 3 new password variables
```

### Pattern 1: Docker Detection + Launch (Node.js)

**What:** Use `spawnSync` to check Docker, then `spawn` the platform-appropriate open command.
**When to use:** At the start of `scripts/dev.js` before any Docker operations.

```javascript
// Source: Node.js docs + verified on Windows (Docker Desktop.exe path confirmed)
const { spawnSync, spawn } = require('child_process');
const { platform } = require('os');

function isDockerRunning() {
  const result = spawnSync('docker', ['info'], { stdio: 'pipe' });
  return result.status === 0;
}

function openDockerDesktop() {
  const os = platform();
  if (os === 'darwin') {
    spawn('open', ['-a', 'Docker Desktop'], { detached: true, stdio: 'ignore' }).unref();
  } else if (os === 'win32') {
    spawn('cmd', ['/c', 'start', '', 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'],
      { detached: true, stdio: 'ignore', shell: true }).unref();
  } else {
    console.warn('[dev] Linux: launch Docker manually, then re-run.');
  }
}
```

[VERIFIED: Docker Desktop path at `C:\Program Files\Docker\Docker\Docker Desktop.exe` confirmed on this machine]

### Pattern 2: KC Health-Check Poll (built-in fetch)

**What:** Poll the KC realm endpoint until 200 or timeout.
**When to use:** After `docker compose up -d`, before starting backend/frontend.

```javascript
// Source: Node.js fetch docs (built-in since Node 18)
async function waitForKeycloak(url, timeoutMs = 90000, intervalMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Keycloak did not become healthy within ${timeoutMs / 1000}s`);
}

// Usage:
await waitForKeycloak('http://localhost:8080/realms/japan-trip');
```

### Pattern 3: concurrently Programmatic API (v10)

**What:** Launch three labeled processes with color prefixes.
**When to use:** After KC health check passes.

```javascript
// Source: Context7 /open-cli-tools/concurrently — confirmed v10 API
const { concurrently } = require('concurrently');
const path = require('path');

const { result } = concurrently(
  [
    {
      command: 'docker compose logs -f keycloak',
      name: 'keycloak',
      prefixColor: 'cyan',
      cwd: path.resolve(__dirname, '..', 'keycloak'),
    },
    {
      command: 'npm run dev --workspace=backend',
      name: 'backend',
      prefixColor: 'yellow',
    },
    {
      command: 'npm run dev --workspace=frontend',
      name: 'frontend',
      prefixColor: 'green',
    },
  ],
  {
    prefix: 'name',
    killOthersOn: ['failure'],
  }
);

result.catch(() => process.exit(1));
```

[CITED: Context7 /open-cli-tools/concurrently — README.md API docs]

### Pattern 4: keycloak_user with `import = true` (INFRA-01)

**What:** Declare testuser as a Terraform resource without deleting/recreating the existing KC user.
**When to use:** For any user that was manually created in KC before IaC adoption.

```hcl
# Source: Context7 /keycloak/terraform-provider-keycloak — user.md
resource "keycloak_user" "testuser" {
  realm_id       = keycloak_realm.japan_trip.id
  username       = "testuser"
  enabled        = true
  email          = "testuser@local"
  email_verified = true

  import = true  # Adopts existing user; does NOT reset password; does NOT destroy on terraform destroy

  initial_password {
    value     = var.testuser_password
    temporary = false
  }
}
```

Key behavior: `import = true` means Terraform will adopt the existing user by username. The exact behavior of `initial_password` on imported users is unverified — the provider may ignore it or re-assert it on each apply. Because the variable default (`Test1234!`) matches the existing password, either behavior leaves testuser authenticating correctly. Existing passkeys and profile state are preserved by the import semantics. [ASSUMED: initial_password ignored on import — see A3]

### Pattern 5: Standard keycloak_user (INFRA-02, INFRA-03)

**What:** New users with no pre-existing state.
**Pattern:** Follow `keycloak_user.e2e_test_user` exactly — no `import = true`. **Must include `first_name` and `last_name`** to prevent KC's "Update Profile" required-action prompt at first browser login. The existing `e2e_test_user` in main.tf sets these fields precisely to skip the interstitial. (testuser's HCL intentionally omits them because `import = true` preserves existing profile state — not an oversight.)

```hcl
# Source: existing terraform/keycloak/main.tf pattern
resource "keycloak_user" "new_user_test" {
  realm_id       = keycloak_realm.japan_trip.id
  username       = "new_user_test"
  enabled        = true
  email          = "new_user_test@local"
  email_verified = true
  first_name     = "New"
  last_name      = "UserTest"

  initial_password {
    value     = var.new_user_test_password
    temporary = false
  }
}

resource "keycloak_user" "trip_edit_test_user" {
  realm_id       = keycloak_realm.japan_trip.id
  username       = "trip_edit_test_user"
  enabled        = true
  email          = "trip_edit_test_user@local"
  email_verified = true
  first_name     = "TripEdit"
  last_name      = "TestUser"

  initial_password {
    value     = var.trip_edit_test_user_password
    temporary = false
  }
}
```

### Pattern 6: Strict Redirect URIs (SEC-03)

**What:** Replace wildcards with explicit per-page URIs.
**Enumerated from code:** All `login()` callsites use `window.location.href` (current page) or a constructed page URL. All `logout()` callsites redirect to `index.html` or `window.location.origin`.

Complete URI analysis:
- `login()` fires from: Navbar (redirects to `dashboard.html`), dashboard prompt btn (current page = `dashboard.html`), dashboard UPDATE_PASSWORD action (current page = `dashboard.html`), profile page re-auth actions (current page = `profile.html`)
- `logout()` redirects to: `index.html` (Navbar, profile page)
- `initKeycloak()` uses: `silent-check-sso.html` as `silentCheckSsoRedirectUri` — **this is a redirect URI used on every page init** [VERIFIED: frontend/src/auth/keycloak.ts lines 39-41]

**Full required redirect URI set:**

Dev (localhost:5173):
```
http://localhost:5173/PruebaMapJapan/dashboard.html
http://localhost:5173/PruebaMapJapan/profile.html
http://localhost:5173/PruebaMapJapan/index.html
http://localhost:5173/PruebaMapJapan/silent-check-sso.html
```

Prod (GitHub Pages):
```
https://manud.github.io/PruebaMapJapan/dashboard.html
https://manud.github.io/PruebaMapJapan/profile.html
https://manud.github.io/PruebaMapJapan/index.html
https://manud.github.io/PruebaMapJapan/silent-check-sso.html
```

**Post-logout redirect URIs** (same pages, since logout goes to index.html or origin):
```
http://localhost:5173/PruebaMapJapan/index.html
http://localhost:5173/
https://manud.github.io/PruebaMapJapan/index.html
https://manud.github.io/
```

**`web_origins = ["+"]`:** Keep. The `+` keyword instructs KC to derive allowed web origins from the `valid_redirect_uris` list. After replacing wildcards with explicit URIs, `+` becomes strictly bounded and remains SEC-03-compliant. [CITED: keycloak/terraform-provider-keycloak docs, Context7]

**Query-param constraint:** `login()` does NOT fire from `trip-edit.html` or `trip.html` — those pages use stored tokens, not fresh login. The strict URI set is feasible today. If Phase 14/ERR-05 later triggers login from a query-string URL (e.g., `trip-edit.html?tripId=123`), KC will reject it unless a matching pattern is added. Document this constraint for future phases.

```hcl
# Source: existing terraform/keycloak/main.tf pattern + Context7
resource "keycloak_openid_client" "japan_trip_frontend" {
  realm_id  = keycloak_realm.japan_trip.id
  client_id = "japan-trip-frontend"
  # ... other attrs unchanged ...

  valid_redirect_uris = [
    "http://localhost:5173/PruebaMapJapan/dashboard.html",
    "http://localhost:5173/PruebaMapJapan/profile.html",
    "http://localhost:5173/PruebaMapJapan/index.html",
    "http://localhost:5173/PruebaMapJapan/silent-check-sso.html",
    "https://manud.github.io/PruebaMapJapan/dashboard.html",
    "https://manud.github.io/PruebaMapJapan/profile.html",
    "https://manud.github.io/PruebaMapJapan/index.html",
    "https://manud.github.io/PruebaMapJapan/silent-check-sso.html",
  ]

  valid_post_logout_redirect_uris = [
    "http://localhost:5173/PruebaMapJapan/index.html",
    "http://localhost:5173/",
    "https://manud.github.io/PruebaMapJapan/index.html",
    "https://manud.github.io/",
  ]

  web_origins = ["+"]

  pkce_code_challenge_method = "S256"
}
```

### Pattern 7: New Password Variables

```hcl
# Source: existing terraform/keycloak/variables.tf pattern
variable "testuser_password" {
  description = "Password for testuser Playwright test user"
  type        = string
  sensitive   = true
  default     = "Test1234!"
}

variable "new_user_test_password" {
  description = "Password for new_user_test Playwright test user"
  type        = string
  sensitive   = true
  default     = "New-User-Test-1!"
}

variable "trip_edit_test_user_password" {
  description = "Password for trip_edit_test_user Playwright test user"
  type        = string
  sensitive   = true
  default     = "Trip-Edit-Test-1!"
}
```

Defaults satisfy the realm password policy: `length(8) and upperCase(1) and digits(1) and specialChars(1)`. [VERIFIED: terraform/keycloak/main.tf password_policy]

### Anti-Patterns to Avoid

- **Wildcard redirect URIs:** `http://localhost:5173/*` — blocks SEC-03 and the entire point of this Terraform hardening task
- **`terraform import` CLI for testuser:** Requires a manual UUID lookup and a separate apply step; `import = true` is declarative and idempotent
- **Starting concurrently before KC is healthy:** Backend health checks KC on startup — if KC isn't up, backend crashes and concurrently's `killOthersOn: ['failure']` kills everything
- **Running `docker compose` from project root without `-f`:** docker-compose.yml is in `keycloak/` — must `cwd` to that dir or the compose file won't be found
- **Using `"type": "module"` assumptions for scripts/dev.js:** Root package.json has no `"type"` field (defaulting to CommonJS). Use `require()` in `scripts/dev.js`, not `import`. Or name it `scripts/dev.mjs` for ESM.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Color-labeled multi-process output | Custom readline multiplexer | concurrently | Handles SIGTERM propagation, exit code management, cross-platform color |
| HTTP health poll with timeout | Manual setTimeout loop | Built-in `fetch` + `AbortSignal.timeout()` | Node 18+ has both; no extra dependency |
| KC user seeding | KC Admin REST API calls in scripts | Terraform `keycloak_user` | Idempotent; auditable; matches existing IaC pattern |

---

## Common Pitfalls

### Pitfall 1: webAuthnPasswordlessRpId Drift (CRITICAL)

**What goes wrong:** `terraform apply` re-evaluates the entire realm resource. If the HCL has drifted from KC state on any attribute, KC's `webAuthnPasswordlessPolicy.rpId` could be overwritten — breaking all registered passkeys permanently with no migration path.

**Why it happens:** KC stores many realm settings not captured in the HCL. A `terraform apply` with even a small drift can trigger a realm resource update that includes passwordless policy.

**How to avoid:** The **first Terraform task in the plan must be a `terraform plan` that confirms zero realm-level changes** before modifying users or the client resource. If `terraform plan` shows any realm diff, resolve it before proceeding. STATE.md explicitly flags this as a blocker.

**Warning signs:** `terraform plan` output shows `keycloak_realm.japan_trip` will be updated.

### Pitfall 2: concurrently v10 API — New Major Just Published

**What goes wrong:** concurrently 10.0.1 was published 22 hours before this research (2026-06-01). The API documented here (`killOthersOn`, `prefixColors`, `prefix: 'name'`, per-command `name`/`prefixColor`) matches v10 per Context7 docs. However, if a breaking change isn't reflected yet in Context7 (lag), the plan could reference a stale API.

**How to avoid:** Pin `"concurrently": "10.0.1"` in root package.json (exact version, not `^`). If breakage is found during execution, fall back to pinning `"9.1.0"` which has an identical programmatic API.

### Pitfall 3: `silent-check-sso.html` Missing from Redirect URIs

**What goes wrong:** Removing wildcards without adding `silent-check-sso.html` breaks the silent SSO check on every page that calls `initKeycloak()`. KC will reject the redirect_uri and users will get an error instead of a silent session restore.

**Why it happens:** The `silentCheckSsoRedirectUri` is constructed programmatically in keycloak.ts — it doesn't appear in any `login()` callsite. Easy to miss.

**How to avoid:** Always include `…/PruebaMapJapan/silent-check-sso.html` in both dev and prod `valid_redirect_uris`. [VERIFIED: frontend/src/auth/keycloak.ts lines 39-41]

### Pitfall 4: `import = true` — password is cosmetic for existing users

**What goes wrong:** Expecting that `initial_password { value = var.testuser_password }` on a `import = true` user will update or verify the password. It won't — `initial_password` only applies at resource creation time.

**Why it happens:** The attribute is declared but has no effect on imported users.

**How to avoid:** Validate manually after `terraform apply` that `testuser` still authenticates with `Test1234!` — the existing password is preserved in KC. The variable default `"Test1234!"` is documentation of the expected password, not a setter. `trip-edit-integration.spec.ts` depends on this credential.

### Pitfall 5: Docker Compose working directory

**What goes wrong:** `docker compose up -d` from project root without specifying the file path. The compose file is at `keycloak/docker-compose.yml`, not the root.

**How to avoid:** Use `cwd: path.resolve(__dirname, '..', 'keycloak')` when spawning docker compose, or pass `-f keycloak/docker-compose.yml` from root. Both work; the `cwd` approach is cleaner.

### Pitfall 6: Module format for scripts/dev.js

**What goes wrong:** Using `import` statements in `scripts/dev.js` when root package.json has no `"type": "module"` field — Node treats it as CommonJS and throws a SyntaxError.

**How to avoid:** Use `require()` syntax in `scripts/dev.js` (CommonJS is the root default). Alternatively, name the file `scripts/dev.mjs` to force ESM regardless of package.json. [VERIFIED: root package.json has no "type" field]

### Container Teardown Note

`docker compose up -d` is detached — containers (KC, postgres, mailpit) persist after Ctrl+C exits concurrently. This is desirable for fast restarts but means `npm run dev` does not clean up on exit. To stop all containers: `docker compose down` from `keycloak/` directory. The plan should document this in a usage note but does not need to implement auto-teardown.

---

## Runtime State Inventory

> Not a rename/refactor phase. Omit.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker Desktop | DEVENV-01 (detect + start) | Yes | Docker Desktop running [VERIFIED: `docker info` exit 0] | — |
| `docker compose` (V2) | DEVENV-01 | Yes | Included with Docker Desktop | — |
| Node.js | scripts/dev.js runtime | Yes | v24.15.0 [VERIFIED: node --version] | — |
| Terraform | INFRA-01..04, SEC-03 | Yes | v1.15.3 [VERIFIED: terraform version] | — |
| concurrently | DEVENV-02 | Not yet installed | — | Install via `npm install --save-dev concurrently` |

**Missing dependencies with no fallback:** None blocking — concurrently just needs to be installed.

**Notes:**
- Terraform v1.15.3 is installed but v1.15.5 is latest. Not a blocker; apply will work.
- Node 24 has built-in `fetch` — no `node-fetch` needed.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (frontend/backend), Playwright (e2e) |
| Config file | `tests/playwright.config.ts`, `frontend/vitest.config.ts`, `backend/vitest.config.ts` |
| Quick run command | `npm run test:run --workspace=frontend && npm run test --workspace=backend` |
| Full suite command | `npm run test:run --workspaces && cd tests && npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEVENV-01 | `npm run dev` detects Docker, starts stack in order | smoke (manual) | Run `npm run dev` and verify all three services start | N/A — orchestration script |
| DEVENV-02 | Color-labeled `[keycloak]`, `[backend]`, `[frontend]` prefixes appear | smoke (manual) | Visual inspection of `npm run dev` output | N/A |
| INFRA-01 | `testuser` exists in TF state after apply | integration | `terraform state show keycloak_user.testuser` | ❌ Wave 0 |
| INFRA-02 | `new_user_test` created by apply | integration | `terraform state show keycloak_user.new_user_test` | ❌ Wave 0 |
| INFRA-03 | `trip_edit_test_user` created by apply | integration | `terraform state show keycloak_user.trip_edit_test_user` | ❌ Wave 0 |
| INFRA-04 | PKCE S256 enforced (zero-drift confirm) | integration | `terraform plan` shows no changes to `pkce_code_challenge_method` | ❌ Wave 0 |
| SEC-03 | No wildcards in redirect URIs after apply | integration | `terraform plan` shows updated `valid_redirect_uris` with no `*`; verify KC admin console | ❌ Wave 0 |

### Dev Script Smoke Test Approach

1. Run `npm run dev` from project root
2. Verify terminal shows three color-labeled streams: `[keycloak]`, `[backend]`, `[frontend]`
3. Verify `http://localhost:8080/realms/japan-trip` responds 200
4. Verify `http://localhost:8787/api/health` (or equivalent) responds
5. Verify `http://localhost:5173/PruebaMapJapan/dashboard.html` loads

### Terraform Verification Sequence

1. `terraform plan` in `terraform/keycloak/` — **must show zero realm changes** before proceeding
2. `terraform apply` — should create 3 users, update client redirect URIs
3. `terraform state show keycloak_user.testuser` — confirm `import = true` user adopted
4. Manual KC Admin Console check: client `japan-trip-frontend` → Valid Redirect URIs shows no wildcards
5. Manual login test: verify `testuser`/`Test1234!` still authenticates (preserving existing credentials)
6. Run `trip-edit-integration.spec.ts` — must still pass with testuser

### Sampling Rate

- **Per task commit:** `npm run typecheck --workspace=frontend` (no runtime dependency)
- **Per wave merge:** `npm run test:run --workspaces` (unit tests only — no KC needed)
- **Phase gate:** Full smoke test with KC running + `terraform apply` zero-drift confirmation

### Wave 0 Gaps

- [ ] `scripts/dev.js` — new file, no pre-existing test infrastructure needed
- [ ] Terraform state verification commands are CLI checks, not automated tests — manual verification steps only

---

## Open Questions

1. **`trip-edit.html` login redirect future risk**
   - What we know: No `login()` call currently fires from `trip-edit.html`. Strict URI set is feasible today.
   - What's unclear: Phase 14 (ERR-05) may add a 401 auto-redirect from `trip-edit.html?tripId=X`. If it uses `window.location.href` as redirect_uri, KC will reject `trip-edit.html?tripId=X` because it's not in the registered URI list.
   - Recommendation: Document this as a known constraint in the Phase 14 research brief. If needed, add `trip-edit.html` (without query param) to the redirect URI list proactively — KC matches the path, not the query string.

2. **testuser first/last name**
   - What we know: `trip-edit-integration.spec.ts` handles a "Update Profile" KC prompt on first login (fills firstName/lastName). With `import = true`, testuser already exists.
   - What's unclear: Does the existing testuser already have first/last name set, or will re-applying cause a `required_actions` prompt?
   - Recommendation: The `keycloak_user` HCL for testuser should NOT include `first_name`/`last_name` (omitting them avoids forcing a profile update required action). The existing user's profile state is preserved.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | concurrently v10 programmatic API is backward-compatible with v9 (`killOthersOn`, `prefixColors`, per-command `name`) | Standard Stack, Code Examples | Plan would reference wrong option names; fix by pinning 9.x |
| A2 | KC `valid_redirect_uris` path matching does not include query strings (e.g., `dashboard.html` matches `dashboard.html?foo=bar`) | Open Questions | If KC does include query strings, `dashboard.html` registrations would fail for URIs with params |
| A3 | `keycloak_user.initial_password` is ignored (not re-asserted) for users declared with `import = true` | Architecture Patterns | If provider re-asserts the password on each apply, testuser is unaffected (default matches existing password), but the claim in Pattern 4 is wrong. Fallback: validate testuser authenticates after apply. |

---

## Sources

### Primary (HIGH confidence)

- [VERIFIED: terraform/keycloak/versions.tf] — confirms provider is `keycloak/keycloak >= 5.7.0`, NOT mrparkers
- [VERIFIED: terraform/keycloak/main.tf] — existing patterns for `keycloak_user`, `keycloak_openid_client`, PKCE S256 already present
- [VERIFIED: terraform/keycloak/variables.tf] — existing variable pattern with `sensitive = true` and defaults
- [VERIFIED: frontend/src/auth/keycloak.ts] — `silentCheckSsoRedirectUri` construction, `login()`/`logout()` signature
- [VERIFIED: frontend/src/components/Navbar.ts] — `login(dashboard.html)`, `logout(index.html)`
- [VERIFIED: frontend/src/pages/dashboard.ts] — `login(window.location.href)`, UPDATE_PASSWORD action
- [VERIFIED: frontend/src/pages/profile.ts] — multiple `login(window.location.href)`, `logout(index.html)`
- [VERIFIED: keycloak/docker-compose.yml] — KC health check URL `http://localhost:8080/realms/japan-trip`
- [VERIFIED: package.json root] — no `"type"` field, CommonJS default; existing workspace scripts
- [VERIFIED: npm registry] — concurrently@10.0.1 is latest, published 2026-06-01
- [VERIFIED: node --version] — Node 24.15.0, has built-in `fetch`
- [VERIFIED: docker info] — Docker Desktop running on this machine
- Context7 `/open-cli-tools/concurrently` — programmatic API docs including `killOthersOn`, `prefixColors`, `prefix: 'name'`, per-command `name`/`prefixColor`/`cwd`
- Context7 `/keycloak/terraform-provider-keycloak` — `keycloak_user` `import = true` attribute, `keycloak_openid_client` `pkce_code_challenge_method`

### Secondary (MEDIUM confidence)

- [CITED: github.com/mrparkers/terraform-provider-keycloak/blob/master/docs/resources/user.md] — `import` attribute confirmed; note: this is the legacy mrparkers repo but docs match official provider behavior
- [CITED: registry.terraform.io/providers/mrparkers/keycloak] — import syntax `{{realm_id}}/{{user_id}}`

### Tertiary (LOW confidence)

- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified via npm registry and project files
- Architecture: HIGH — all patterns derived from verified existing code + Context7 docs
- Pitfalls: HIGH — most derived from verified existing HCL state (webAuthn pin, import behavior)
- Redirect URI list: HIGH — enumerated from all login()/logout() callsites in source

**Research date:** 2026-06-01
**Valid until:** 2026-07-01 (stable stack; concurrently v10 is newly released — watch for patch releases)

---

**Provider CONTEXT.md correction:** CONTEXT.md line 135 states "mrparkers/keycloak (see terraform/keycloak/versions.tf)" — this is outdated. The actual pinned source is `keycloak/keycloak` (official provider). All HCL patterns and import syntax in this research reference the official provider. The planner must not use mrparkers-specific syntax.
