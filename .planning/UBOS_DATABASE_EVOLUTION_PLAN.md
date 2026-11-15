# UBOS Database Evolution Plan

## Current baseline

Prisma/PostgreSQL currently stores users, sessions, organizations, memberships, roles/permissions, branches/branch access, audit events, categories, products, one inventory row per product, stock movements, customers, suppliers, sales/items, purchase invoices/items, and payments. Money fields use `Decimal(14,2)`. Current migrations are the Phase 1 foundation and Phase 2 business operations migrations. This document does not connect to or inspect live data.

## Migration rules

1. Never edit an already-applied migration; add a new timestamped migration.
2. Prefer expand → backfill → validate → constrain → contract. Keep old and new app versions compatible during deployment where needed.
3. Before adding a NOT NULL/unique/FK/check constraint, write a read-only data audit query and remediation plan; do not silently delete or rewrite records.
4. Use explicit `Decimal` precision, UTC timestamps, stable IDs, and tenant scope on owned rows.
5. Preserve source facts and audit history. Correct posted business facts with reversals/adjustments, not destructive edits, once policy is approved.
6. Test migrations from a supported previous schema and verify rollback/recovery strategy; do not promise reversible DDL where it is not.

## Candidate evolution by dependency

| Order | Data evolution | Why / decision required | Migration considerations |
|---|---|---|---|
| 1 | Idempotency operation record: org, operation, key digest, request hash, status/response reference, timestamps | Prevent retry duplicates for writes. Decide replay response, key scope and retention | Backfill not needed; unique scope index; do not store secrets/raw credentials; same transaction as business effect where feasible |
| 2 | Tenant-aware compound references for org-owned relationships; payment target invariant | Make tenant consistency and exactly-one target database-enforced | Audit existing links first; add composite unique keys to parent and composite FKs; remediate bad rows before constraint; review Prisma relation support/migration SQL |
| 3 | Invoice lifecycle/reversal source records and correction references | Required for void/refund/credit flows; semantics must be approved | Keep current rows; add lifecycle with safe defaults; backfill existing sales/purchases as posted/issued only after confirming meaning |
| 4 | Inventory costing representation | Required only after method choice | FIFO may need receipt lots/remaining quantities and issue allocations; moving average needs cost/quantity history and rounding policy; opening balance conversion requires explicit valuation input |
| 5 | Audit event read/retention metadata, if needed | Query API exists only after policy | Add indexes after query patterns; restrict metadata and define retention/export/deletion rules |
| 6 | Payment allocations and accounting journal | Enables payments across invoices and GL/subledgers | New allocation and journal tables with balanced-entry rule; migrate existing one-invoice payment links to one allocation; reconcile totals before cutover |
| 7 | Warehouse/branch dimensions | Enables location inventory/access | Decide branch vs warehouse hierarchy; add location references and opening stock/movement mapping; do not add arbitrary nullable IDs without semantics |
| 8 | Currency/rate data | Multi-currency support | Store currency code and original amount; rate, source, and effective time; define legacy default currency only with product decision |

## Tenant integrity design

At minimum evaluate compound uniqueness on parent `(organizationId, id)` and compound foreign keys from child `(organizationId, referencedId)` to prevent cross-organization links. Candidate relationships include product/category, invoice/customer or supplier, invoice line/product and parent invoice, inventory/product, stock movement/product, payment/invoice, membership/role, and branch access. Prisma schema support and generated client consequences must be checked before committing to exact syntax. Keep guards and scoped queries; database constraints are a second boundary, not a replacement.

For `Payment`, enforce exactly one target (sale or purchase invoice) at the database layer if the selected schema/database approach supports a reliable check. Keep service validation too. A future generalized payment allocation model may supersede this constraint, so avoid migrations that make that later move needlessly difficult.

## Costing alternatives

| Method | Data needs | Benefits | Trade-offs |
|---|---|---|---|
| FIFO | Receipt lots, remaining lot quantity, issue allocations | Traceable lot costs and natural purchase history | More rows/logic; returns and negative stock require explicit handling |
| Moving weighted average | Current quantity/value or cost history by movement | Simpler issue valuation and commonly usable for operational stock | Average recalculation/rounding and backdated receipts need defined behavior |
| Latest purchase cost (current approximation) | Existing `Product.costPrice` | Simple display estimate | Cannot reliably value mixed-cost on-hand stock; must not be presented as audited inventory valuation |

Do not choose a method without accounting/product approval. Also decide landed costs, tax inclusion, returns, write-offs, and backdated receipt policy.

## Accounting data boundary

Operational sales/purchase/payment rows are not a general ledger. Future journals should have balanced lines, account/period/currency, source event, posting actor/time, and reversal link. Define whether operational events post synchronously in the same transaction or through a transactional outbox; choose only after consistency and availability requirements are agreed. A synchronous same-database transaction is simpler; an outbox supports async delivery but needs retries, deduplication, and lag monitoring.

## Safety and verification

- Keep migrations under `packages/database/prisma/migrations/` and update `schema.prisma` only during implementation approval.
- Run schema diff/validation and migration tests in an isolated database, never production data.
- Before every constraint migration: report row counts and violating IDs without exposing sensitive values.
- After migration: reconcile user/org counts, invoice totals, payment balances, inventory movement sum vs on-hand, and accounting debits/credits where applicable.
- Never use reset, db push, or destructive cleanup against a non-test target.
