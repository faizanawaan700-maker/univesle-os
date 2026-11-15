# ARCHITECTURE.md — Universal Business OS (UBOS)

## High-level shape
UBOS is a three-tier web application:
1. Next.js web client (`apps/web`) — App Router, client-side data fetching.
2. NestJS REST API (`apps/api`) — controller/service/guard architecture.
3. PostgreSQL database accessed through the shared Prisma package (`packages/database`).

Authentication and business operations live in the same NestJS application.

## API surface
All endpoints are under the API root (default `http://127.0.0.1:4000`):
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /organizations`
- `POST /organizations`
- `GET /organizations/current` (requires `X-Organization-Id` + membership)
- `/business/*` (organization-scoped business operations)

## Authentication and sessions
- Registration creates a user, organization, Owner role, owner permissions, membership, session, and audit log in one transaction.
- Passwords use Node.js `crypto.scrypt` with fixed parameters (`N=16384`, `r=8`, `p=1`, key length 64).
- Session token is 32 random bytes (base64url). Only its SHA-256 hash is persisted.
- `AuthGuard` is a global guard. Routes marked `@Public()` (register/login) bypass it.
- Session lookup validates expiry and deletes expired sessions.
- Cookie: `ubos_session`, `httpOnly`, `sameSite: strict`, `secure` only in production, path `/`.

## Authorization and multi-tenancy
- Global guards in order: `OriginGuard`, `ThrottlerGuard`, `AuthGuard`.
- Business and current-organization routes additionally use `OrganizationScopeGuard` and `PermissionsGuard`.
- `OrganizationScopeGuard` reads `X-Organization-Id`, verifies membership, and attaches `request.organization` with role key and permission list.
- `PermissionsGuard` checks required permissions from `@RequirePermissions(...)`.
- Owner permissions are defined in `apps/api/src/common/owner-permissions.ts`.
- Tenant isolation is enforced by scoping Prisma queries with `organizationId`.

## Business operations module
`OperationsController` (base path `/business`) and `OperationsService` implement:
- Product categories and products
- Inventory listing and adjustments
- Customers
- Suppliers
- Sales invoices
- Purchase invoices (with stock receipt)
- Payments
- Summary report
- Low-stock inventory report

Key behaviors:
- Mutations run through `runTransaction`, which retries transaction conflicts (`P2034`).
- Purchase invoices receive stock and create stock movements.
- Sales create stock movements and decrement inventory.
- Payments update invoice outstanding balances.
- Money values use `Prisma.Decimal`; string inputs are validated by regex.

## Web client
- `apps/web/src/app/page.tsx` manages authentication, organization selection, and layout.
- `apps/web/src/app/business-operations.tsx` implements permission-gated tabs and forms for business operations.
- API calls use `fetch` with `credentials: "include"` and `X-Organization-Id`.
- API base URL comes from `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`).

## Data and persistence
- Database client is created in `packages/database/src/prisma.ts` using `PrismaPg` adapter and `DATABASE_URL`.
- Prisma schema defines users, sessions, organizations, memberships, roles, permissions, branches, audit logs, and business entities.
- Migrations are applied separately via `migrate:deploy`; tests do not apply migrations.

## Error handling
- DTO validation errors are returned by NestJS `ValidationPipe`.
- Domain errors use NestJS exceptions: `BadRequestException`, `ConflictException`, `ForbiddenException`, `NotFoundException`, `UnauthorizedException`.
- Prisma unique constraint errors are translated to conflict messages.
- Not-found record errors are handled where relevant.
- Database transaction conflicts are retried automatically.

## Security controls
- `OriginGuard` requires matching `Origin` for mutating requests.
- CORS is restricted to configured frontend origin with credentials.
- Helmet security headers.
- Rate limiting through throttler.
- HTTP-only strict same-site session cookie.
- No request bodies, passwords, session values, or financial data in logs (documented).
- Tenant-scoped handlers must use `OrganizationScopeGuard` and scope queries by organization.
