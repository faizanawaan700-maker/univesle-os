# UBOS Architecture Roadmap

## Current architecture

```text
Next.js client (apps/web)
  └─ credentialed fetch + organization header
      └─ NestJS API (apps/api)
          ├─ global Origin / throttling / session guards
          ├─ organization scope + permission guards
          ├─ auth, organizations, operations services
          └─ Prisma package (packages/database) → PostgreSQL
```

The repository is a non-workspace npm monorepo; API uses a packed local database package. Keep this structure during core stabilization. No evidence justifies speculative microservices or a framework replacement.

## Target evolution

### Stage A — trustworthy operational core

Retain the three-tier structure. Make route contracts unambiguous, idempotency durable, optional-field semantics explicit, and tenant relationships constrained. Keep business transactions in services and Decimal arithmetic server-side. Add pagination and invoice detail before broadening UI workflows. Add operational event records and read access under a specific permission.

### Stage B — accounting-ready source records

Keep operational documents (sales, purchases, receipts, stock movements) as source facts. Do not relabel payments as accounting. Design a posting boundary that creates balanced journal entries from approved business events, references source records, supports reversals, and respects period close. The exact accounting basis, chart of accounts, tax treatment, and currency model are product/accounting decisions.

### Stage C — organizational scale

Extend tenant scope to branches and warehouses only after defining their relationship and access policy. Enforce scope in guards and queries and add composite database constraints where the data model supports them. Preserve org-wide owner access only through explicit grants, not hidden fallback behavior.

### Stage D — integrations and intelligence

Use adapter boundaries around external providers, durable delivery/retry state, webhook signature checks, and idempotent event handling. AI reads only data the user may access. AI-created actions become proposed commands with provenance and require explicit user confirmation plus normal API authorization.

## Architecture decisions and gates

| Decision | Options | Decision gate |
|---|---|---|
| Inventory cost | FIFO, moving weighted average, another documented method | Before inventory value is called an accounting balance; analyze existing stock/history migration |
| Ledger basis | Cash, accrual, or staged operational-only first | Before journal postings/financial statements |
| Payment allocation | One payment per invoice (current), allocation join for many invoices, unapplied credit | Before AR/AP expansion |
| Location model | Branch only, warehouse only, branch containing warehouses | Before branch-level stock/access work |
| Corrections | Void-before-post plus immutable reversal after post, or another approved lifecycle | Before cancellation/refund UI/API |
| Idempotency storage | Same-DB operation record and response vs equivalent durable design | Before exposing retry-safe write contract |
| API compatibility | Additive contract vs versioned route | Before changing response shapes or consumers |

## Quality attributes

- **Consistency:** one database transaction for each business operation and its movements/audit records; explicit idempotency for retryable writes.
- **Isolation:** authorization at organization scope now; branch/warehouse scope only after policy is defined. Query filters and database constraints reinforce each other.
- **Availability/recovery:** readiness/health probes, bounded shutdown, backups, restore tests, and documented rollback before production launch.
- **Scale:** stable cursor pagination, indexes based on real filters, batch/report query plans, and measured load tests before adding infrastructure.
- **Observability:** structured logs with request/operation IDs; never log credentials, raw session tokens, sensitive bodies, or payment details unnecessarily.

## Technology posture

Keep Next.js, NestJS, Prisma, PostgreSQL, TypeScript, and current test tools unless measurements or requirements prove a limitation. Prefer built-in database transactions, constraints, and existing libraries. Add dependencies only with an identified capability gap, maintenance/security review, and removal plan.
