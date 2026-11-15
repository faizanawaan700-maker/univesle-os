# UBOS Product Vision

**Status:** planning baseline, not a launch promise  
**Baseline inspected:** current workspace source; API unit suite passed (10 suites, 41 tests). PostgreSQL integration, browser journeys, builds, and production behavior were not verified.

## Vision

UBOS is a multi-tenant business operations platform that gives an organization a reliable, traceable view of its catalog, stock, counterparties, sales, purchases, payments, and eventually accounting. The product must preserve business history and explain how balances were produced. A route or screen alone does not make a workflow complete: the user must be able to create, inspect, correct through an auditable process, and reconcile the record.

The first goal is a trustworthy core for small businesses. Medium and large organization needs—branches, warehouses, delegated roles, larger histories, and integration controls—depend on first establishing tenant-safe data boundaries, explicit business rules, and a tested API contract. AI, forecasting, voice, and document intelligence are later capabilities built on governed business data; they must not bypass permissions or silently post high-impact actions.

## Current product baseline

The workspace contains a Next.js client, NestJS API, and Prisma/PostgreSQL package. It currently supports account registration/login, organizations and memberships, permission checks, catalog and stock operations, customer/supplier create/list, sales and purchase creation, payment recording, and a basic summary report. The UI has one-line invoice forms; APIs accept multiple lines. Update APIs exist for products and contacts, but contact editing is not exposed in the UI. List routes impose fixed caps and do not provide pagination. Audit events are written but no audit-history route or screen was found.

This is an early operations foundation, not a complete ERP, general ledger, tax-compliance product, or production-certified service. Existing unit tests passed in this audit. Integration tests exist but were not run because they connect to and write to PostgreSQL.

## Product principles

1. **Correct before broad:** every financial or stock effect must be explainable, tenant-scoped, and safe to retry.
2. **History over destructive edits:** posted records should be corrected with explicit reversals/adjustments once accounting rules are approved.
3. **Server authority:** the API validates all inputs and calculates money; browser validation improves usability only.
4. **Explicit scope:** organization and later branch/warehouse access are enforced by the server and, where practical, by database constraints.
5. **No invented policy:** costing, tax, fiscal periods, refunds, and approval thresholds require product/accounting decisions before implementation.
6. **Useful failure behavior:** a timeout or stale page must not silently duplicate an operation or misstate its result.
7. **Incremental evolution:** preserve the current stack and data; use reviewed migrations and compatibility windows rather than rewrites.

## Core users and value

| User | Near-term value | Later value |
|---|---|---|
| Owner | Create organization, catalog, contacts, invoices, record payments, see basic stock/balances | Accounting controls, branches, reports, integrations, approvals |
| Operations staff | Record receipts, sales, and stock changes | Warehouse workflows, delegated permissions, alerts |
| Finance staff | Inspect invoice and payment history | Reconciliation, general ledger, period close, statements |
| Manager | Review organization activity and summaries | Analytics, forecasts, governed recommendations |
| Auditor/admin | See scoped actions and access history | Retention/export controls and enterprise audit tooling |

These are target roles, not a claim that role administration exists today.

## Product stages

- **Core operations:** reliable catalog, stock ledger, contacts, multi-line invoices, payments, history, corrections, and basic reports.
- **Accounting foundation:** chart of accounts, journal postings, receivables/payables, cash/bank accounts, reconciliation, closing, and statements. This requires explicit accounting design; payment rows alone are not a ledger.
- **Organization scale:** employee invitations, role administration, branch/warehouse assignment, and scoped activity.
- **Intelligence and ecosystem:** analytics, forecasting, automation, AI, integrations, localization, and multi-currency.
- **Production operations:** deployment, monitoring, backup/restore, security review, and scale validation.

## Success measures

Set numeric targets after a pilot baseline. At minimum measure: duplicate financial effects per replay (target zero), cross-tenant access denials, invoice-to-payment reconciliation variance (target zero), stock ledger-to-on-hand variance (target zero), percentage of core flows covered by repeatable integration/E2E checks, and successful restore drills. Do not use an arbitrary product-completion percentage.
