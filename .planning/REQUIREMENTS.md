# Requirements: UBOS

**Core value:** Every business record and financial/stock effect must be correctly scoped, traceable, and safe to retry.

## Active requirements

### Data safety
- [ ] **DATA-01**: Replaying a supported write with the same idempotency key and payload produces one business effect and returns a stable result.
- [ ] **DATA-02**: Reusing an idempotency key with a different payload is rejected without mutation.
- [ ] **DATA-03**: Update routes use their path ID as the only entity identifier.
- [ ] **DATA-04**: PATCH distinguishes omitted values from explicit clearing of nullable fields.
- [ ] **DATA-05**: Organization-owned relationships and payment target invariants are protected by both application checks and appropriate DB constraints.

### Core operations
- [ ] **OPS-01**: Sales and purchase forms support multi-line invoices whose server-calculated totals reconcile to persisted lines.
- [ ] **OPS-02**: Users can inspect invoice details and payment history within their organization.
- [ ] **OPS-03**: Customers and suppliers can be edited from the UI with clear-field semantics.
- [ ] **OPS-04**: Stock changes and their ledger/audit records commit or roll back together and cannot violate approved negative-stock policy.
- [ ] **OPS-05**: Growing lists support bounded cursor pagination, filtering, and stable ordering without silent truncation.
- [ ] **OPS-06**: Authorized users can inspect organization-scoped audit history.
- [ ] **OPS-07**: Reports reconcile to source invoices/payments and disclose unresolved costing/accounting limitations.

### Accounting and enterprise foundations
- [ ] **FIN-01**: Accounting journals are balanced, source-linked, reversible, and period-aware after policy approval.
- [ ] **ORG-01**: Membership/role and later branch/warehouse boundaries are explicit, least-privilege, and tested.
- [ ] **OPS-08**: Invoice cancellation, correction, refund, and reversal behavior is implemented only after policy approval.
- [ ] **PLAT-01**: Production deployment, observability, backup/restore, security, and scaling requirements are verified before any readiness claim.

### Future capabilities
- **FUT-01**: BI, forecasting, CRM automation, notifications, integrations, localization, multi-currency, voice/document intelligence, and AI actions follow stable core data and permission boundaries.
- **FUT-02**: AI cannot silently perform high-impact financial or stock actions; proposals require authorization and explicit approval.

## Out of scope until decisions are approved

| Decision | Blocks |
|---|---|
| FIFO vs moving weighted average vs other costing | Accounting-grade inventory value |
| Cash vs accrual basis and chart of accounts | General ledger and statements |
| Tax jurisdictions, rates, inclusive/exclusive treatment | Tax compliance and automated tax calculations |
| Refund, credit note, void and period-close policy | Posted document correction flows |
| Payment allocations/unapplied credits | Multi-invoice settlement |
| Branch vs warehouse hierarchy | Location-scoped inventory and access |

## Traceability

Detailed module requirements are in `UBOS_PRODUCT_REQUIREMENTS.md`; phase mapping is in `ROADMAP.md` and `UBOS_IMPLEMENTATION_PHASES.md`.
