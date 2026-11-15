# UBOS Definition of Done

Use this checklist per feature and phase. “Implemented” means behavior is traceable through UI/API/data and has evidence; a button, route, model, or passing compile alone is insufficient.

## Product and contract

- [ ] User, workflow, business value, permissions, and acceptance examples are defined.
- [ ] Product/accounting decisions and unresolved assumptions are recorded.
- [ ] API request/response, validation, status/error behavior, pagination and compatibility are documented.
- [ ] UI has loading, empty, success, error, retry, and stale-data behavior appropriate to the workflow.

## Correctness and data

- [ ] Server validates all input; Decimal strings remain exact through calculations and persistence.
- [ ] All records and nested references are scoped to the authenticated organization and later branch/warehouse scope.
- [ ] Business writes and dependent movement/audit/ledger records commit or roll back atomically as designed.
- [ ] Retry behavior is idempotent where duplicate effects would matter.
- [ ] Corrections preserve history; deletion/archive behavior follows approved retention policy.
- [ ] Database constraints encode critical invariants where feasible; migration and backfill plan is reviewed.
- [ ] Financial, payment, and inventory totals reconcile to source records.

## Security, privacy, and accessibility

- [ ] Permission checks exist server-side and are tested for both allow and deny paths.
- [ ] No secrets, session values, sensitive request bodies, or unnecessary personal/payment data are logged or returned.
- [ ] Tenant and branch boundary attempts fail without mutating data.
- [ ] Audit metadata is safe, scoped, and useful; sensitive fields are excluded/redacted.
- [ ] Forms and navigation work by keyboard; labels, focus, and error announcements are usable.
- [ ] External integrations verify signatures and handle replay; AI actions cannot bypass normal authorization or approval.

## Verification evidence

- [ ] Relevant DTO and service unit tests pass.
- [ ] API contract and tenant/permission tests pass.
- [ ] DB integration, rollback, and concurrency tests pass in an isolated dedicated database when persistence is involved.
- [ ] Browser E2E covers the modified user journey; responsive/accessibility checks are run where UI changes.
- [ ] Build/typecheck and migration validation pass when relevant.
- [ ] Performance/security checks are proportional to risk and have recorded results.
- [ ] Unrun tests and limitations are stated; no unsupported “production-ready” claim is made.

## Release and operations

- [ ] Migration order, compatibility window, backup, rollback/recovery, and data remediation are documented.
- [ ] Health, structured logs, metrics/alerts, request/operation correlation, and owner are defined for production paths.
- [ ] Backup restore has been tested against agreed recovery objectives before production launch.
- [ ] Feature flags/rollout/rollback are used where risk or migration compatibility requires them.
- [ ] Documentation and permission matrix are updated; stale planning maps are corrected without overwriting unrelated user work.

## Phase exit criteria

- **Phase 0:** source-linked baseline, test/environment rules, and decisions register reviewed.
- **Phase 1:** no duplicate side effects on replay; route IDs authoritative; tenant/payment invariants tested; rollback proof exists.
- **Phase 2:** complete multi-line sale/purchase journey and approved correction lifecycle reconcile through UI/API/DB.
- **Phase 3:** no silent history truncation; audit is reviewable; search/paging and accessible UI are verified.
- **Phase 4:** balanced journal and subledger reconciliation proven; accounting policy and period close approved.
- **Phase 5:** invitation/role/location lifecycle and cross-scope denial verified without privilege regression.
- **Phase 6:** analytics tie to source facts; forecasts disclose validation and limitations; alerts are deduplicated.
- **Phase 7:** AI scope is enforced server-side; high-impact actions require explicit approval; provenance is auditable.
- **Phase 8:** provider retries/replays are safe; currency and tax provenance are retained; sandbox contract checks pass.
- **Phase 9:** repeatable deploy/rollback, monitored service, restore drill, security review, and agreed load targets are evidenced.
