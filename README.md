# Universal Business OS

Phase 1 foundation for a multi-tenant business operations platform. The repository contains a Next.js web client, NestJS REST API, and shared PostgreSQL/Prisma database package. Packages are installed independently instead of using npm workspaces: the approved Windows sandbox blocks npm's workspace symlink creation. The API consumes a packed local copy of the database package using npm's `file:` dependency with `--install-links`.

## Requirements

- Node.js 20.19+, 22.12+, or 24+ and npm
- PostgreSQL 14 or newer

PostgreSQL was not available in the initial development environment. The API requires a configured database and deliberately fails to start if it cannot connect; it does not switch to mock or in-memory persistence.

## Local setup (PowerShell)

Copy `packages/database/.env.example` to `packages/database/.env` and replace the placeholder password locally. This ignored file is loaded by Prisma and the API; do not commit it or share its contents. The API and Prisma load `packages/database/.env`; the root `.env.example` is a reference template for process-level variables and is not loaded automatically.

```powershell
& 'C:\Program Files\nodejs\npm.cmd' install --prefix packages/database
& 'C:\Program Files\nodejs\npm.cmd' run build --prefix packages/database
& 'C:\Program Files\nodejs\npm.cmd' install --prefix apps/api --install-links
& 'C:\Program Files\nodejs\npm.cmd' install --prefix apps/web
& 'C:\Program Files\nodejs\npm.cmd' run build --prefix apps/api
& 'C:\Program Files\nodejs\npm.cmd' run build --prefix apps/web
& 'C:\Program Files\nodejs\npm.cmd' run migrate:deploy --prefix packages/database
& 'C:\Program Files\nodejs\npm.cmd' run dev:api
```

After applying the existing migration, run database-backed API tests against this same dedicated local database:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test:integration --prefix apps/api
```

The integration test command rejects non-local PostgreSQL URLs and databases other than `ubos_development`. It creates uniquely named test accounts and removes only those accounts and their dependent test records afterward. It does not apply migrations automatically.

In another terminal:

```powershell
$env:NEXT_PUBLIC_API_URL = 'http://localhost:4000'
& 'C:\Program Files\nodejs\npm.cmd' run dev:web
```

The API defaults to `127.0.0.1:4000`; the web client defaults to `localhost:3000`. Set `FRONTEND_ORIGIN` to the exact browser origin. `NEXT_PUBLIC_API_URL` is embedded into the web build, so set it before running `next build` in production. Prisma 7 uses the PostgreSQL driver adapter; the database client and Prisma CLI both require `DATABASE_URL` in the current process environment. For production, use HTTPS and set `NODE_ENV=production` so session cookies are marked secure. Session lifetime is configurable from 1 to 30 days.

## Phase 1 API

All endpoints are under the API root URL.

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register` | Create an account and first organization, assign owner permissions, create a session |
| POST | `/auth/login` | Verify credentials and issue a session |
| POST | `/auth/logout` | Revoke the current session |
| GET | `/auth/me` | Return the authenticated profile and organization memberships |
| GET | `/organizations` | List only the caller's memberships |
| POST | `/organizations` | Create an organization and assign the caller as owner |
| GET | `/organizations/current` | Resolve the selected organization via `X-Organization-Id`, after membership authorization |

Mutating requests must include the configured `Origin`. The API uses an HTTP-only, strict same-site session cookie, credentialed CORS restricted to the configured frontend, server-side membership checks, DTO validation, security headers, and request throttling.

## Data and security notes

- Passwords use Node.js scrypt; session tokens are cryptographically random and only their SHA-256 hashes are stored.
- User email is normalized to lowercase. Registration and organization creation are transactional with the initial owner membership, permissions, session, and audit event.
- Organization-owned rows include an `organizationId` foreign key; memberships, roles, permissions, branches, and audit events have database constraints and indexes.
- Tenant-scoped API handlers must use `OrganizationScopeGuard` and scope all database queries by the resulting `request.organization.id`. The current organization endpoint and its cross-tenant denial test demonstrate this boundary.
- Logs do not include request bodies, passwords, session values, or financial data.
- Dependency install hooks are governed by package-scoped, version-pinned `allowScripts` entries: the database package permits Prisma 7.10.1 hooks, while the API denies `@parcel/watcher` 2.6.0's install hook. The user-level npm configuration was not changed.
- This phase does not implement team invitations, password recovery, or a production email flow.

## Commands

- `npm run dev:api` — NestJS API
- `npm run dev:web` — Next.js client
- `npm start --prefix apps/api` — run the built API
- `npm test` — build the database package and run API unit tests
- `npm run build` — database package, API, and web builds

The API's local database-package dependency is installed as a packed copy, not a symlink. After changing the database package's published files or Prisma schema, rebuild it and run `npm install --prefix apps/api --install-links` directly from the shell to refresh that copy before building or testing. The root `dev:api`, `test`, and `build` scripts rebuild the database package first, and that package's build runs `prisma generate` against `packages/database/prisma/schema.prisma`; the API scripts themselves do not run `prisma generate`. Installations create package-local lockfiles. The API install explicitly denies `@parcel/watcher`'s native install hook while retaining its prebuilt optional dependencies.
