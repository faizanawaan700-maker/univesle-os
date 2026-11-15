# UBOS Implementation Phases

This plan is ordered by data correctness and decision dependencies. Every item is planned work, not completed work. Apply migrations only through reviewed, forward-compatible migrations after explicit implementation approval.

## Phase 0 — Baseline and architecture stabilization

**Goals/tasks:** Confirm live source baseline; maintain API/data ownership map; record current permission keys and transaction boundaries; specify HTTP error/validation conventions; establish test tiers and safe database separation; document unresolved business decisions. Revalidate audit findings before each implementation slice.

**Likely files:** `.planning/codebase/*.md`, new planning docs here, `README.md`, package scripts/configs only if later approved.  
**DB/API/UI:** No schema changes; no product behavior change.  
**Security/tests:** No secrets or production data in tests; keep integration DB guard. Unit tests require no DB; integration requires isolated `ubos_development`.  
**Dependencies:** None.  
**Risks:** Stale mapping or hidden existing user changes.  
**Acceptance / DoD:** Baseline and decisions are source-linked; no contradictory scope; current checks and non-executed checks are distinguished; no source or schema changes in this planning phase.

## Phase 1 — Critical data correctness

**Goals/tasks:** Add idempotency for sales, payments, purchase receipt and stock adjustments; source update IDs from route; define PATCH omission/null semantics; strengthen org-consistent foreign-key/payment-target invariants; verify transactional rollback and authorization. Reconcile existing records before constraint migration.

**Likely files:** `apps/api/src/operations/operations.controller.ts`, `operations.dto.ts`, `operations.service.ts`, `apps/api/src/common/transactions.ts`; `packages/database/prisma/schema.prisma` and a new migration if durable keys/constraints are approved; corresponding tests; UI request helper in `apps/web/src/app/business-operations.tsx`.  
**DB/API/UI:** Likely DB changes for idempotency record and constraints; additive request header/key contract; UI generates/stores a stable key per logical submit and reuses it after retry.  
**Security:** Scope idempotency keys to organization, operation, and authenticated actor as policy requires; bind key to request hash; same key/different payload returns conflict; do not leak stored response across tenants.  
**Tests:** Unit validation; integration replay/same-key mismatch, concurrent duplicate, cross-tenant relation, payment exact-one, rollback.  
**Dependencies:** Phase 0; decision on replay response/retention.  
**Risks:** Old rows may violate constraints; retry response could expose data if key scope is weak.  
**Acceptance:** Replaying a completed logical request yields one side effect; transaction failures leave no partial invoice/payment/movement/audit; mismatched route/body IDs cannot target another record.  
**DoD:** Data audit/backfill plan approved; migration reviewed; unit and dedicated DB tests pass; compatibility documented.

## Phase 2 — Complete core business workflows

**Goals/tasks:** Multi-line sales/purchases; invoice detail; customer/supplier editing; payment references and clear outstanding selection; inspect movement history; define stock correction and invoice lifecycle (draft/posted/void/reversal) before implementing. Preserve posted history.

**Likely files:** `apps/web/src/app/business-operations.tsx`; `apps/api/src/operations/operations.dto.ts`, `operations.controller.ts`, `operations.service.ts`; Prisma schema/migrations only if lifecycle/allocation fields are approved.  
**DB/API/UI:** API line arrays already exist; implement UI line collections and detail responses. Lifecycle/reversal may need status/event/credit records and API commands.  
**Security:** Every line/reference validated against the same organization; corrections require explicit manage permission and audit event.  
**Tests:** Multi-line arithmetic and stock behavior, failure rollback, lifecycle transition matrix, permission tests, browser form tests.  
**Dependencies:** Phase 1; product/accounting decisions for posted corrections.  
**Risks:** Reversal of a paid invoice or stock already sold requires explicit business handling.  
**Acceptance:** Source supplier invoice can be represented as one multi-line document; detail equals saved totals; corrections produce reconciliable history.  
**DoD:** API contract and UI errors documented; end-to-end sale and purchase journey verified in isolated test DB.

## Phase 3 — Business usability and data access

**Goals/tasks:** Cursor pagination for all growing lists; search, filters, deterministic sorting; complete movements and audit views; improve validation/loading/empty/error states; accessible keyboard tab behavior; category/product/contact management completion.

**Likely files:** `operations.controller.ts`, `operations.dto.ts`, `operations.service.ts`, `apps/web/src/app/business-operations.tsx`, `apps/web/src/app/globals.css`, audit module files to add, tests.  
**DB/API/UI:** Mostly additive API query contracts; add indexes only after query patterns are known and migration plans reviewed.  
**Security:** Filters never replace org scoping; audit metadata is minimized; exports are permission-controlled.  
**Tests:** Pagination boundary/stability, query-scope tests, accessibility checks, browser search/filter flows.  
**Dependencies:** Phase 1 contracts; Phase 2 entity detail semantics.  
**Risks:** Cursor changes may break clients; expensive wildcard search can degrade database.  
**Acceptance:** No silent hard truncation; user can reach records beyond prior limits; sorting is stable; keyboard and screen-reader states are coherent.  
**DoD:** Measured query/index plan for representative dataset; API/UI pagination tests pass.

## Phase 4 — Accounting and financial management

**Goals/tasks:** Design chart of accounts, journals, source-event posting, AR/AP, cash/bank, payment allocations, reconciliation, statements, tax, refunds/credit notes, period close and audit trails. Start with requirements and accounting review; then implement one reconciled slice at a time.

**Likely files:** New accounting module under `apps/api/src/`; new UI module(s); `owner-permissions.ts` only after permission matrix approval; Prisma models/migrations; financial and integration tests.  
**DB/API/UI:** Significant additive schema; versioned posting contracts; reports/drill-down/period UI.  
**Security:** Separation of duties, posting permission, immutable/traceable journals, period lock enforcement, least-privilege exports.  
**Tests:** Balanced journal invariant, subledger-to-GL reconciliation, allocations, reversal/refund, closed-period rejection, Decimal/property edge tests.  
**Dependencies:** Phases 1–3; explicit cash/accrual, tax, costing, and fiscal-period decisions.  
**Risks:** Incorrect accounting policy can require historical restatement; migration/backfill may be substantial.  
**Acceptance:** All posted journal entries balance; AR/AP tie to source documents and allocations; reports reconcile for a closed test period.  
**DoD:** Accounting design signed off; migration rehearsal and reconciliation evidence retained; no claim of statutory compliance without jurisdiction review.

## Phase 5 — Organization, employees and branches

**Goals/tasks:** Invitations and acceptance, member lifecycle, role editor, branch/warehouse ownership model, branch-scoped inventory/operations, access boundaries and organization settings.

**Likely files:** `apps/api/src/organizations/*`, guards, permissions definitions, new team/location modules, web organization UI, Prisma schema/migrations, auth integration tests.  
**DB/API/UI:** Membership/invite/role/location models and scoped API.  
**Security:** Preserve existing owner behavior; migration must map legacy owners and deny by default for newly scoped access.  
**Tests:** Invite lifecycle, role change/revocation, cross-org and cross-branch isolation, concurrent membership changes.  
**Dependencies:** Phase 1 tenant constraints; approved role and location model.  
**Risks:** Lockout or privilege escalation during role migration.  
**Acceptance:** Users see and mutate only assigned scope; owner recovery path is tested; org-wide totals reconcile with branch totals.  
**DoD:** Compatibility and rollback plan; no implicit permission expansion.

## Phase 6 — Advanced business intelligence

**Goals/tasks:** Analytics by date/product/location, demand and inventory forecasts, customer/supplier insights, dashboards, alert rules and automation. Distinguish observed facts from predictions.

**Likely files:** New reporting/analytics API and web modules; query indexes; optional scheduled-job infrastructure only if needed.  
**DB/API/UI:** Read models/materialization only after query measurements; export and alert endpoints.  
**Security:** Reuse user scopes; aggregate data must not cross tenants; alert content must avoid sensitive leakage.  
**Tests:** Metric reconciliation, date/time/currency edge cases, forecast evaluation against held-out historical periods, delivery retries.  
**Dependencies:** Core pagination, accounting definitions, clean historical data.  
**Risks:** Misleading forecasts or expensive scans.  
**Acceptance:** Metrics trace to source records; prediction quality and limits are disclosed; alerts are deduplicated.  
**DoD:** Product validates usefulness against pilot users; operational cost is measured.

## Phase 7 — AI Business Manager

**Goals/tasks:** Design natural-language read queries, explainable recommendations, document understanding, voice capture, and approval-based actions. No silent high-impact writes.

**Likely files:** New AI orchestration module, scoped tool definitions, web approval/review UX, audit events, provider adapter/configuration; no changes to existing business services without normal authorization path.  
**DB/API/UI:** Store provenance, user approval, model/provider and action result where policy requires.  
**Security:** Tool allowlists; org/branch scope passed from server identity, never trusted from model text; redact secrets/PII; prompt injection and data exfiltration defenses; explicit confirmation for stock/financial commands.  
**Tests:** Authorization boundary, adversarial documents/prompts, tool invocation allowlist, approval and replay behavior, output provenance.  
**Dependencies:** Stable core permissions, audit viewer, accounting rules for financial actions.  
**Risks:** Hallucinated values, prompt injection, sensitive-data disclosure, unapproved writes.  
**Acceptance:** AI cannot increase its own scope or post unapproved high-impact actions; every suggestion/action is attributable and reviewable.  
**DoD:** Security/privacy review and measured quality before pilot.

## Phase 8 — Integrations and localization

**Goals/tasks:** Payment gateways (if accepting money), accounting integrations, email/notifications, import/export, multi-currency, rates, localization, jurisdiction tax configuration.

**Likely files:** New provider adapters/webhook modules, integration settings UI, schemas/migrations, localization resource files, test fixtures.  
**DB/API/UI:** Provider account references/secrets managed outside source; webhook/event ledger; currency/rate provenance; locale preferences.  
**Security:** Webhook signature verification, encrypted secret storage/reference, OAuth scopes, replay defense, data deletion/retention.  
**Tests:** Contract/sandbox tests, webhook replay, provider outage/retry, currency conversion/reconciliation, locale rendering.  
**Dependencies:** Idempotency and audit (Phase 1), accounting/tax decisions (Phase 4), security boundaries.  
**Risks:** External API change, duplicate settlement, exchange-rate mismatch, jurisdictional noncompliance.  
**Acceptance:** External event retries are safe; imported/exported records reconcile; original currency and conversion source/time are retained.  
**DoD:** Provider-specific sandbox and failure drills pass; legal/tax claims reviewed.

## Phase 9 — Production and scaling

**Goals/tasks:** CI/CD, release gates, health/readiness, structured logs, monitoring/alerts, backup/restore, security review, load test, deployment/rollback, disaster recovery.

**Likely files:** CI/deployment files to add, `apps/api/src/main.ts`, package scripts, runbooks and operational docs.  
**DB/API/UI:** Migration sequencing/backups; no API/UI feature presumed.  
**Security:** TLS/origin/cookie/proxy review, secret rotation, dependency scanning, least privilege, incident response.  
**Tests:** Build/typecheck, migrations from supported versions, restore drills, load and failure tests, security assessment.  
**Dependencies:** Stable phases 1–5; hosting and recovery objectives selected.  
**Risks:** Incorrect proxy configuration, failed migration rollback, untested backup.  
**Acceptance:** Repeatable deployment/rollback; monitored health; restored backup meets agreed RPO/RTO; load targets met.  
**DoD:** Release checklist evidence and named operational owner exist.
