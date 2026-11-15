# INTEGRATIONS.md — Universal Business OS (UBOS)

## Database integration
- PostgreSQL 14+ is the only persistent data store.
- Prisma 7.10.1 uses `@prisma/adapter-pg`.
- `packages/database/src/prisma.ts` creates `PrismaClient` using `DATABASE_URL`.
- If `DATABASE_URL` is missing, the database package throws at load time.
- The API calls `database.$connect()` during bootstrap and fails to start if PostgreSQL is unavailable.
- No mock or in-memory persistence fallback exists.

## Package integration
- API depends on `@ubos/database` via `file:../../packages/database`.
- The dependency is installed as a packed local copy using `--install-links`, not a symlink.
- After changing database package published files or Prisma schema, rebuild the database package and reinstall it into the API before building/testing.
- Root scripts rebuild the database package first.

## Web/API integration
- Web client calls the API at `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`).
- Requests use `credentials: "include"`.
- Organization-scoped requests send `X-Organization-Id`.
- API CORS allows only `FRONTEND_ORIGIN` with credentials.
- Mutating requests require matching `Origin`.

## Environment variables
Observed in `.env.example` and code:
- `DATABASE_URL` — PostgreSQL connection string.
- `API_PORT` — API port (default 4000).
- `API_HOST` — API bind host (default 127.0.0.1).
- `FRONTEND_ORIGIN` — allowed browser origin (default `http://localhost:3000`).
- `SESSION_TTL_DAYS` — session lifetime, 1–30 days (default 7).
- `NODE_ENV` — controls secure cookies and log level.
- `TRUST_PROXY_HOPS` — trust proxy configuration.
- `NEXT_PUBLIC_API_URL` — web client API base URL.

## Prisma schema and migrations
- Schema: `packages/database/prisma/schema.prisma`.
- Migrations:
  - `20261105000000_phase1_foundation`
  - `20261106000000_phase2_business_operations`
- Migration lock provider: `postgresql`.
- Generated client output: `packages/database/src/generated/client`.

## External services
- No external SaaS integrations are present in application code.
- No email, queue, cache, or object storage integration is present.
- Phase 1 explicitly does not implement team invitations, password recovery, or production email flow.

## Local setup integration points
- Copy `packages/database/.env.example` to `packages/database/.env` locally (do not commit).
- Run migrations with `npm run migrate:deploy --prefix packages/database`.
- Integration tests use only local `ubos_development` database.
- Web requires `NEXT_PUBLIC_API_URL` before production build because it is embedded into the build.
