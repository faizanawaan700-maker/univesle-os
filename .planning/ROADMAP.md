# Roadmap: UBOS

## Overview

Evolve the existing MVP incrementally: stabilize correctness and tenant boundaries first, complete core operational journeys, add history/access usability, then build accounting, organization-scale features, intelligence, AI, integrations/localization, and production readiness. Existing detailed requirements and phase criteria are maintained in `UBOS_IMPLEMENTATION_PHASES.md`.

## Phases

- [ ] **Phase 1: Critical data correctness** — idempotency, route IDs, clear semantics, tenant/payment invariants.
- [ ] **Phase 2: Complete core business workflows** — multi-line invoices, details, contacts, correction policies.
- [ ] **Phase 3: Usability and data access** — pagination, search, audit history, accessible UI.
- [ ] **Phase 4: Accounting and financial management** — policy-gated journals, AR/AP, reconciliation.
- [ ] **Phase 5: Organization, employees, branches** — membership and location scope.
- [ ] **Phase 6: Business intelligence** — reconciled analytics, forecasting, alerts.
- [ ] **Phase 7: AI Business Manager** — scoped, approval-based assistant.
- [ ] **Phase 8: Integrations and localization** — provider adapters, currencies, locales.
- [ ] **Phase 9: Production and scaling** — CI/CD, monitoring, backup/restore, security and load evidence.

## Phase 1 plan

**Goal:** Make write retries, update targeting, and tenant/data invariants safe before expanding workflows.  
**Depends on:** Existing source baseline; no live database access.  
**Requirements:** DATA-01 through DATA-05.  
**Success criteria:** same-key replay has one effect; key/payload mismatch rejects; route ID is authoritative; nullable clear semantics are explicit; tenant/payment invariants have a reviewed migration and test plan.  
**Plans:** GSD execution plan to be generated before phase implementation.

## Decision gates

Phases 2–3 can proceed without choosing accounting basis, but posted correction semantics must be decided before implementing void/refund flows. Phase 4 requires accounting and costing decisions. Phase 5 requires a branch/warehouse model. Phases 6–8 depend on reliable core data, permissions, and audit. Phase 9 requires a hosting target and recovery objectives.
