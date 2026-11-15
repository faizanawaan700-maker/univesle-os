# UBOS API Contract Plan

## Current contract conventions

NestJS controllers expose auth, organization, and `/business/*` routes. DTOs use class-validator and global whitelist/forbid-non-whitelisted validation. Business requests send `X-Organization-Id`; the server resolves membership and permissions. Mutations require the configured Origin. Money is sent as decimal strings. Preserve these conventions unless a reviewed decision changes them.

## Contract work by phase

### Phase 1: safe mutations

- PATCH entity ID comes only from `:id`; remove duplicated `id` from update DTOs.
- Define PATCH semantics: omitted means unchanged; explicit `null` means clear only for nullable fields; reject null for required fields.
- Add `Idempotency-Key` to supported business mutations. Scope it server-side, bind to normalized request hash, replay original result for same hash, return conflict for key reuse with different request. Document expiration and in-progress behavior.
- Keep organization ID derived from authorized header context, never accepted as an arbitrary body field.
- Keep domain errors stable and non-sensitive; distinguish 400 invalid input, 401 unauthenticated, 403 forbidden, 404 unavailable scoped entity, 409 conflicts, and retryable server failures.

### Phase 2: core document workflows

- Sale and purchase create accept 1–100 lines as they do now; UI must submit actual line arrays. Define whether repeated product IDs are aggregated or retained as separate lines.
- Add invoice detail endpoints returning line snapshots, totals, allocations/payments and lifecycle state, all scoped by organization.
- Add explicit lifecycle commands (e.g. void/reverse) only after policy defines allowed transitions and their stock/payment effects. Avoid generic PATCH of posted financial totals.
- Add contact PATCH through UI using explicit clear semantics. Align response types with UI rather than using broad `unknown` state.

### Phase 3: list contract

Use cursor pagination with stable composite ordering (timestamp + unique ID) and opaque `nextCursor`; return items and continuation metadata. Add allowlisted filters for search, date range, status, product/customer/supplier as appropriate. Never allow a caller-supplied organization filter to broaden access. Bound page size and validate sort keys.

Candidate endpoints: `GET /business/sales`, `/purchases`, `/payments`, `/products`, `/customers`, `/suppliers`, `/inventory`, `/inventory/movements`, `/audit`. Maintain backwards compatibility for current no-query calls during migration, or introduce a documented version only if response shape must break.

### Phase 4+: accounting and integration contracts

- Keep operational source-document endpoints separate from journal posting/period-close commands.
- Represent payment allocations explicitly if many-to-many allocation is approved.
- Use signed webhooks, event IDs, idempotent ingestion, and status visibility for integrations.
- AI tools call normal scoped API commands; approval is explicit and recorded.

## Error, validation, and response rules

- Return DTO validation errors in a consistent field-addressable shape suitable for inline form messages.
- Do not return Prisma internals, SQL, secrets, raw cookies, or stack traces to clients.
- Use decimal strings at boundaries; never convert money to JavaScript floating point for calculations.
- Define timestamp format as ISO-8601 UTC and cursor behavior for concurrent inserts.
- Keep request IDs in response/log context without logging sensitive body content.

## Permission contract

Preserve existing permission names through core stabilization. Add no permission keys until an approved role/action matrix exists. Each route declares required permissions; tests assert both allowed and denied paths. Audit read, branch access, and accounting permissions require explicit decisions.

## Contract verification

For each endpoint, maintain DTO tests, service behavior tests, HTTP status/shape tests, tenant-denial tests, and at least one browser consumer test. Add idempotency and concurrency cases for mutations. Any schema/API rollout that spans versions must document compatibility and deployment order.
