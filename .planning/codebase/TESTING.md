# TESTING.md — Universal Business OS (UBOS)

## Test frameworks
- Backend unit tests: Jest 30.0.4 with ts-jest.
- Backend integration tests: Jest with a separate config.
- Web: no test scripts or test configuration observed.

## Unit test configuration
File: `apps/api/jest.config.js`
- `rootDir: "."`
- `testRegex: ".*\\.spec\\.ts$"`
- `testPathIgnorePatterns: [".*\\.integration\\.spec\\.ts$"]`
- transform: ts-jest for `.t|js`
- `testEnvironment: "node"`
- `collectCoverageFrom: ["src/**/*.ts"]`

## Unit tests observed
- `apps/api/src/auth/password.spec.ts`
- `apps/api/src/common/origin.spec.ts`
- `apps/api/src/common/prisma-errors.spec.ts`
- `apps/api/src/common/trust-proxy.spec.ts`
- `apps/api/src/organizations/organization-scope.guard.spec.ts`
- `apps/api/src/organizations/permissions.guard.spec.ts`
- `apps/api/src/operations/money.spec.ts`

## Integration test configuration
File: `apps/api/jest.integration.config.js`
- Extends base Jest config.
- `testRegex: ".*\\.integration\\.spec\\.ts$"`
- `testPathIgnorePatterns: ["/node_modules/"]`
- `setupFiles: ["<rootDir>/src/load-local-env.ts"]`

Integration test file:
- `apps/api/src/phase1.integration.spec.ts`

Guard:
- `apps/api/src/test-support/assert-integration-database.ts` validates that `DATABASE_URL` points to a local PostgreSQL host and database name `ubos_development`.

## Commands
- Root unit test: `npm run build --prefix packages/database && npm test --prefix apps/api`
- API unit test: `npm test --prefix apps/api` (Jest `--runInBand`)
- API integration test: `npm run test:integration --prefix apps/api`
- API watch tests: `npm run test:watch --prefix apps/api`

## Database test behavior
- Integration tests require PostgreSQL 14+ and a database named `ubos_development`.
- The integration command rejects non-local PostgreSQL URLs and databases other than `ubos_development`.
- Tests create uniquely named test accounts and remove only those accounts and dependent test records.
- Migrations are not applied automatically by tests.

## Coverage and quality notes
- Coverage collection is configured for `src/**/*.ts`.
- No web tests are present.
- No end-to-end test framework is present.
- No CI workflow files were observed in the application repository root.
- Database state and test execution were not run during this mapping (no database connection attempted).
