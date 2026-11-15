# UBOS Testing Strategy

## Current evidence

API unit suite ran in this audit: **10 suites, 41 tests passed**. The database integration file contains auth/tenant and a core catalog-stock-sale-purchase-payment-report journey, including a concurrent payment scenario. It was not run because it connects to PostgreSQL and writes test data. No web test/E2E configuration was found. Build/typecheck was not run.

## Test layers

| Layer | Focus | PostgreSQL? | Examples / gate |
|---|---|---:|---|
| DTO/unit | Validators, money boundaries, pure helpers, permission metadata | No | Email length, null/omission, exact decimal boundaries, bad payloads |
| Service unit | Mocked dependencies, business rules, org scopes, error mapping | No | Sale totals, line aggregation, payment overpay, stock below zero, rollback invocation semantics |
| API/module | HTTP validation, guards, cookies, status/shape, Origin/CORS behavior | Usually no; DB mocked or test module seam | Route ID is authoritative; cross-tenant 404/403 policy; permission denial |
| DB integration | Prisma constraints, real transactions, persistence and rollback | Yes, isolated dedicated test DB only | Schema/migrations, composite FKs, duplicate uniqueness, transaction rollback |
| Concurrency | Simultaneous sale/payment/adjustment and idempotency replay | Yes | Same idempotency key gives one effect; distinct legitimate keys behave independently |
| Reconciliation | Invoice, allocations, journal, stock movement and on-hand equality | Yes | Sum of lines/tax/discount = invoice total; movement sum = quantity; subledger = GL when added |
| Web component | Form line editing, error mapping, empty/loading/stale state | No | Clear optional field, multiple lines, disabled submit, result paging |
| Browser E2E | Critical user journeys across web and API | Yes, isolated environment | Register → organization → product → receipt → customer → sale → payment → history/report |
| Accessibility | Keyboard, screen reader, focus, contrast and responsive behavior | No | Tabs, dialogs/forms, error announcements, small-screen workflows |
| Performance | Query plans, pagination, report scan, representative data volume | Staging/synthetic only | p95 targets defined before test; no production data |
| Security | Tenant/permission abuse, replay, injection, headers, dependency review | Isolated | Authorized scope only; no secret leakage; verified webhook and AI tool boundaries |

## Safe environment rules

- Unit tests should not load a real `.env` or connect to PostgreSQL.
- Integration tests must assert the dedicated local database name and local host before connecting; use unique test identifiers and narrow cleanup.
- Never run integration tests against production, a shared user database, or an unknown URL. Never weaken the database guard to make CI pass.
- CI should provision an ephemeral isolated PostgreSQL database, apply migrations explicitly, run integration tests, then destroy only that ephemeral database.
- Web E2E uses seeded synthetic data and test-only accounts. Keep secrets out of fixtures and screenshots.
- Do not claim a test/build/deployment check passed unless its command actually ran and result was recorded.

## Required regression scenarios

1. Same request key, same payload, concurrent and sequential: one business effect, stable replay result.
2. Same key, different payload: conflict and no second effect.
3. Failed transaction at each write boundary: invoice/payment/movement/audit changes all roll back together.
4. Wrong organization IDs for product/customer/supplier/invoice/branch references: denied with no data mutation.
5. Stock at zero, exactly sufficient, insufficient, repeated product line, concurrent deductions.
6. Money: zero, max supported, rounding half-cent cases from valid internal inputs, discount equal/over subtotal, tax, partial payment, final payment, overpayment.
7. Pagination: empty, first/last page, repeated timestamp, insert between pages, filters remain tenant-scoped.
8. Reversals and accounting: source record preserved, opposite entries balance, closed period guard works.
9. Browser retry after network timeout: request key reused and UI shows resolved original result.
10. Audit reads: allowed actor, denied permission, other tenant, sensitive fields redacted.

## Quality gates

For every implementation phase: format/typecheck, focused unit tests, complete API unit suite, relevant integration suite, browser tests for changed journeys, migration rehearsal where applicable, and security/performance checks proportional to risk. Store test evidence in CI/release output. Coverage percentage alone is not proof of correctness.
