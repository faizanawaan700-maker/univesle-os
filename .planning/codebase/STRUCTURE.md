# STRUCTURE.md — Universal Business OS (UBOS)

## Top-level layout
- `apps/` — application packages.
  - `apps/api/` — NestJS API.
  - `apps/web/` — Next.js web client.
- `packages/` — shared packages.
  - `packages/database/` — Prisma schema, migrations, generated client, DB package.
- `scripts/` — repository/GSD tooling scripts (not application runtime).
- `agents/` — GSD agent definitions.
- `gsd-core/` — GSD workflow/tooling (do not modify).
- `get-shit-done/` — upstream GSD source snapshot (do not modify).
- `.clinerules/` — Cline/GSD rules.
- `node_modules/` — root dependencies (GSD tooling); package-local `node_modules` also exist.
- `.planning/` — GSD planning artifacts (created for codebase mapping).
- Build artifacts present locally: `dist/`, `.next/`, `coverage/` (gitignored).

## API (`apps/api`)
- `src/main.ts` — bootstrap, middleware, CORS, helmet, validation pipe, DB connect.
- `src/app.module.ts` — module registration and global guards.
- `src/load-local-env.ts` — loads `packages/database/.env`.
- `src/auth/` — auth controller, service, DTOs, guard, password hashing, cookie helpers, public decorator.
- `src/common/` — HTTP context types, origin normalization/guard, owner permissions, Prisma error helpers, query limits, transactions, trust-proxy parsing.
- `src/organizations/` — organization service/controller/DTOs, scope guard, permissions guard, decorator.
- `src/operations/` — business operations service/controller/DTOs and money helpers.
- `src/test-support/` — integration database assertion helper.
- `src/*.spec.ts` and `src/**/*.spec.ts` — unit tests.
- `src/phase1.integration.spec.ts` — integration test.
- `dist/` — compiled API output.
- Config: `package.json`, `tsconfig.json`, `jest.config.js`, `jest.integration.config.js`.

## Web (`apps/web`)
- `src/app/layout.tsx` — root layout and metadata.
- `src/app/page.tsx` — authentication, organization selection, main page.
- `src/app/business-operations.tsx` — permission-gated business operations UI.
- `src/app/globals.css` — global styles.
- `.next/` — Next.js build/dev artifacts.
- Config: `package.json`, `tsconfig.json`.

## Database (`packages/database`)
- `src/index.ts` — exports Prisma types and `database` client.
- `src/prisma.ts` — Prisma client creation with `PrismaPg` adapter.
- `src/generated/client/` — generated Prisma client (checked in).
- `prisma/schema.prisma` — data model.
- `prisma/migrations/` — Phase 1 and Phase 2 migrations.
- `prisma.config.ts` — Prisma config.
- `dist/` — compiled package output.
- Config: `package.json`, `tsconfig.json`.

## Important generated/ignored paths
- `node_modules/`, `dist/`, `.next/`, `coverage/`, `.env`, `.env.*` (except `.env.example`) are ignored.
- `packages/database/.env` exists locally but is ignored and must not be committed.
- `packages/database/src/generated` is source-controlled generated code.

## Test files observed
- `apps/api/src/auth/password.spec.ts`
- `apps/api/src/common/origin.spec.ts`
- `apps/api/src/common/prisma-errors.spec.ts`
- `apps/api/src/common/trust-proxy.spec.ts`
- `apps/api/src/organizations/organization-scope.guard.spec.ts`
- `apps/api/src/organizations/permissions.guard.spec.ts`
- `apps/api/src/operations/money.spec.ts`
- `apps/api/src/phase1.integration.spec.ts`
