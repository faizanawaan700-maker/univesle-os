# UBOS Security Plan

## Current controls observed

The API has a global session guard, an Origin guard on mutations, CORS credentials restricted to a configured frontend origin, throttling, Helmet, a strict HTTP-only session cookie, scrypt password hashes, hashed session tokens, DTO validation, organization membership resolution, and permission checks. Business services generally scope reads/writes by the authorized organization. These are source observations; no penetration test, live DB review, dependency scan, or production deployment check was performed.

## Security objectives

1. **Tenant isolation:** derive tenant from an authenticated membership check; scope every query and transaction; add tenant-aware relational constraints. Test direct-object and nested-relation paths.
2. **Branch/warehouse scope:** define a separate scope layer after policy approval. Never infer branch access from organization membership alone.
3. **Authorization:** preserve existing keys initially; maintain an endpoint-to-permission matrix; deny by default; test revocation and role changes.
4. **Auditability:** record actor, action, target, time and safe metadata for security-sensitive and business changes; make audit reads permission- and tenant-scoped; define retention.
5. **Sessions:** retain one-way token storage and secure cookie behavior; define revocation, expiry cleanup, session listing/revocation, and production proxy/TLS deployment checks.
6. **Sensitive data:** never log passwords, cookies/session tokens, database URLs, keys, full payment payloads, or unnecessary personal data. Minimize audit metadata and exports.
7. **Mutation safety:** durable idempotency, request-size limits, rate limits, DTO validation, transaction boundaries, and safe external webhook verification.
8. **AI boundary:** server-derived identity/scope, tool allowlist, read-only default, confirmation for writes, provenance, and audit trail; untrusted document/text content cannot change instructions or permissions.

## Staged security work

| Phase | Work | Evidence required |
|---|---|---|
| 1 | Idempotency scope/hash; route-ID fix; composite tenant constraints; exactly-one payment target; auth and error review | Unit/integration tests for wrong org, replay, key collision, permission denial, constraint violations |
| 2–3 | Safe lifecycle commands, audit API/UI, bounded filters/pagination, field-level validation errors | API contract tests, XSS/output encoding review, audit privacy review, keyboard/accessibility review |
| 4 | Ledger posting and period-close authorization | Separation-of-duty matrix, balanced journal tests, immutable reversal/close tests |
| 5 | Invitation, membership, branch/warehouse administration | Invite expiry/replay, role escalation denial, cross-branch tests, owner recovery test |
| 6–8 | Alerts, integration credentials/webhooks, AI/data access, localization | Secret handling, signature/replay, data minimization, prompt injection and tool boundary tests |
| 9 | Production hardening and incident readiness | Threat model, dependency scan, external security review, restore drill, TLS/proxy/cookie verification |

## Tenant schema migration strategy

1. Inventory tenant-owned foreign-key relationships and query paths.
2. Add parent compound unique keys and child compound references in an expand migration where compatible.
3. Produce a read-only report of mismatches; remediate only with an approved data plan.
4. Add constraints after data is clean; retain application checks and guards.
5. Test cross-tenant relation attempts through both API and DB constraints.
6. Deploy compatible code/migration ordering with backup and rollback plan.

Do not casually redesign RBAC. First document current permission keys, current owner grants, route usage, and legacy membership behavior. Add roles/scopes additively, preserve owner access intentionally, and test migration of existing organizations before changing defaults.

## Data retention and incident controls to decide

Define account/session retention, customer privacy/anonymization, audit retention/export, backup encryption/access, breach response owner, key rotation, and deletion/legal hold policy. These decisions precede production and integrations; this plan does not assume a jurisdiction-specific legal rule.
