# CONCERNS.md — Universal Business OS (UBOS)

## Confirmed from repository inspection

### Repository and tooling
- No Git repository is present in the workspace (`git rev-parse --show-toplevel` fails with “fatal: not a git repository”). `.gitignore` exists, but there is no `.git` directory. GSD commit steps may not work without Git.
- Build artifacts (`dist/`, `.next/`, `coverage/`) are present locally even though they are gitignored.
- `packages/database/.env` exists locally but is gitignored; its contents were not read during this mapping.
- GSD tooling (`gsd-core/`, `get-shit-done/`, `agents/`) is mixed into the application repository root.

### Runtime requirements
- PostgreSQL is mandatory. The API deliberately fails to start if it cannot connect; there is no mock or in-memory fallback.
- Database migrations are not applied automatically by `npm test` or API startup.
- The API database dependency is a packed local copy, so schema/package changes require rebuild and reinstall before testing.

### Testing gaps
- Web has no test scripts or test configuration.
- Integration tests are not included in the default `npm test` command.
- Integration tests require a local database named `ubos_development` and are guarded by `assertIntegrationDatabase`.
- No end-to-end test framework is present.
- No CI configuration was observed in the application repository root.

### Product scope limitations (documented)
- Team invitations are not implemented.
- Password recovery is not implemented.
- Production email flow is not implemented.
- These are documented Phase 1 limitations, not defects.

## Potential concerns (not verified)

- Generated Prisma client is checked into `packages/database/src/generated`; it must be regenerated after schema changes. Stale generated code is possible if regeneration is skipped.
- `NEXT_PUBLIC_API_URL` is embedded into the web build; an incorrect value at build time would require rebuilding.
- Money input regex limits values to 12 digits before the decimal; large monetary values beyond `999999999999.99` are rejected by design.
- Global throttling is 120 requests per 60 seconds; there is no per-user or per-organization rate limiting observed.
- `OriginGuard` rejects mutating requests if `FRONTEND_ORIGIN` is misconfigured; this is strict but could block valid clients.
- Database state and migration application were not inspected because no database connection was attempted.
- No production deployment configuration (Docker, HTTPS termination, process manager) was observed in the repository.
- The repository contains a large GSD tooling surface alongside application code; changes to GSD files should be avoided unless explicitly requested.

## Not assessed
- Database schema runtime state, data integrity, performance, or migration drift.
- Security vulnerability scanning of dependencies.
- Actual test execution results.
- Accessibility or browser compatibility of the web client.
- Secret values (not read).
