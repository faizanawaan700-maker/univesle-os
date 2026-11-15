# CONVENTIONS.md — Universal Business OS (UBOS)

## Language and compiler
- TypeScript with strict base settings (`tsconfig.base.json`).
- API and database packages extend the base config; web uses its own Next.js-oriented config.
- `noImplicitOverride` and `noFallthroughCasesInSwitch` are enabled.
- API uses `experimentalDecorators` and `emitDecoratorMetadata`.

## Backend conventions
- NestJS module/controller/service structure.
- DTOs use `class-validator` decorators; global `ValidationPipe` whitelists and forbids non-whitelisted fields.
- Controllers are thin; business logic lives in services.
- Route-level guards use `OrganizationScopeGuard` and `PermissionsGuard`.
- Permissions are declared with `@RequirePermissions(...)`.
- Public routes use `@Public()`.
- Authenticated request shape is `ApiRequest` (`user?`, `organization?`).

## Multi-tenancy conventions
- Organization-scoped endpoints require `X-Organization-Id`.
- Services accept `OrganizationContext` and scope all queries by `organizationId`.
- Membership is verified before access.
- Permissions are checked against the resolved organization membership, not global user state.

## Transaction and error conventions
- Mutations use `runTransaction` from `apps/api/src/common/transactions.ts`.
- Transaction conflicts (`P2034`) are retried automatically.
- Unique constraint violations are detected with `isUniqueConstraintError`.
- Domain errors use NestJS HTTP exceptions with clear messages.
- Not-found handling uses `isRecordNotFoundError` where applicable.

## Money conventions
- Money is represented as strings at API boundaries and `Prisma.Decimal` internally.
- Input money regex: `^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$`.
- Payment amount regex requires exactly two decimal places.
- Invoice amounts are calculated with `calculateInvoiceAmounts`.
- Outstanding balances are calculated with `outstandingBalance`.
- Money is capped at `999999999999.99`.

## Query and pagination conventions
- List queries use `take: MAX_LIST_ROWS` (1000).
- Low-stock report caps at `MAX_REPORT_LOW_STOCK_ROWS` (100).
- Inventory report processes inventory in batches of `REPORT_INVENTORY_BATCH_SIZE` (500).

## Security conventions
- Mutating requests require matching `Origin`.
- CORS is restricted to `FRONTEND_ORIGIN`.
- Helmet is applied globally.
- Session cookie is HTTP-only, strict same-site, secure in production.
- Passwords and session tokens are never logged.
- Request bodies are not logged.
- Registration and organization creation are transactional with audit events.

## Frontend conventions
- Next.js App Router with client components.
- API base URL from `NEXT_PUBLIC_API_URL`.
- Fetch uses `credentials: "include"`.
- Organization context sent via `X-Organization-Id`.
- Permission-based UI gating via `permissions` array.
- Forms use native HTML controls and `FormData`.

## Naming and file conventions
- Controllers: `*.controller.ts`
- Services: `*.service.ts`
- DTOs: `*.dto.ts`
- Guards: `*.guard.ts`
- Tests: `*.spec.ts`
- Integration tests: `*.integration.spec.ts`
- Common utilities grouped under `src/common/`.

## Environment conventions
- `packages/database/.env` is the local environment file for Prisma/API.
- Root `.env.example` documents variables but is not auto-loaded.
- `DATABASE_URL` must point to the local `ubos_development` database for integration tests.
- `FRONTEND_ORIGIN` must be an absolute URL.
- `SESSION_TTL_DAYS` must be an integer from 1 to 30.
- `TRUST_PROXY_HOPS` must be 0 or 1–10.
