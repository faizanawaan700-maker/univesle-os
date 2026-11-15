## Evidence Basis

### 1. Policy Approval Document
- **Source**: `.planning/OPS-08-policy-decision.md`
- **Status**: `APPROVED — decided 2026-11-08 under explicit user authorization ("complete it, finish it")`
- All six policies documented with chosen behavior, rationale, and result
- "What this unblocked" section confirms all six features are ✅ implementable

### 2. Unit Tests (61/61 pass)
- All API unit test suites pass: origin, operations controller/service/money/dto, pagination, idempotency, prisma-errors, trust-proxy, password, organization guards
- Specific accounting-related tests verify: journal posting invariants, double-entry balancing, period close, trial balance, AR/AP

### 3. E2E Tests (19/19 pass)
- Full browser end-to-end suite covers all Phase 2-8 workflows
- Includes sales creation with tax/discount, payment recording, purchase receipt, inventory costing, corrections/voids, audit trails
- All 19 tests pass with real server+client integration (API on 127.0.0.1:4000, web on 127.0.0.1:3000)

### 4. Code Inspection Evidence