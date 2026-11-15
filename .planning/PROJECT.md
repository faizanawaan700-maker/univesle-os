# Universal Business OS (UBOS)

## What This Is

UBOS is a multi-tenant business operations platform for organizations that need trustworthy catalog, stock, sales, purchase, customer, supplier, and payment workflows. It currently consists of a Next.js client, NestJS API, and Prisma/PostgreSQL package; the current code is an early operational foundation, not a complete accounting or enterprise system.

## Core Value

Every business record and financial/stock effect must be correctly scoped, traceable, and safe to retry.

## Requirements

### Validated
- Authentication, organization membership, permission guards, and core operations exist in source; API unit suite has passed, while DB/browser behavior remains unverified.

### Active
- [ ] Make financial and inventory writes replay-safe and preserve tenant/data invariants.
- [ ] Complete core invoice, contact, inventory, payment, history, and report journeys.
- [ ] Add accounting only after explicit policy decisions and reconciliation design.
- [ ] Prepare organization, location, integration, AI, and production foundations in dependency order.

### Out of Scope for current slices
- Applying migrations or connecting to a live database without explicit authorization.
- Choosing tax, accounting basis, costing, refund, or branch/warehouse policies without product approval.
- Replacing the existing stack or splitting into services without measured justification.

## Context and Constraints

- Existing product specifications: `.planning/UBOS_*.md`.
- Existing source map: `.planning/codebase/`.
- Node/NestJS/Next.js/Prisma/PostgreSQL; packages are installed independently.
- Never access `.env`; never run DB-writing tests against unknown targets; never weaken security/tests.
- Do not modify the separate `get-shit-done/` repo.

## Key Decisions

| Decision | Rationale | Outcome |
|---|---|---|
| Preserve current three-tier stack | No evidence justifies a rewrite | Accepted |
| Do not run/apply DB migrations in this environment | Explicit authorization boundary | Pending deployment approval |
| Costing, accounting basis, tax, refund, payment allocation, location policy | Financial behavior must not be invented | Pending product/accounting decision |
| GSD execution is sequential | Avoid overlapping edits and schema changes | Accepted |
