# STACK.md — Universal Business OS (UBOS)

## Project identity
- Name: `universal-business-os` (root package), apps: `@ubos/api`, `@ubos/web`, `@ubos/database`.
- Type: multi-tenant business operations platform (Phase 1 foundation + Phase 2 business operations).
- Repository layout: non-workspace monorepo. Packages are installed independently because the approved Windows sandbox blocks npm workspace symlink creation.

## Runtime and language
- Node.js 20.19+, 22.12+, or 24+; npm.
- TypeScript 5.9.3 across API, web, and database package.
- Base compiler options in `tsconfig.base.json`: target ES2022, CommonJS, strict mode, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `esModuleInterop`, `forceConsistentCasingInFileNames`.

## Frontend (`apps/web`)
- Next.js 15.5.3 (App Router) with React 19.1.1 and React DOM 19.1.1.
- TypeScript 5.9.3; module resolution `bundler`; JSX `preserve`; path alias `@/* -> ./src/*`.
- Styling: global CSS (`src/app/globals.css`); no CSS framework dependency listed.
- Client components use `"use client"` and browser `fetch`.

## Backend (`apps/api`)
- NestJS 11.1.x: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`.
- Validation: `class-validator` + `class-transformer` via global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`).
- Security/middleware: `helmet`, `@nestjs/throttler` (global 120 requests / 60s), CORS with credentials.
- Password hashing: Node.js `crypto.scrypt`.
- Sessions: cryptographically random token, SHA-256 hash stored in database.
- HTTP adapter: Express; trust proxy hops configurable.

## Database (`packages/database`)
- PostgreSQL 14+.
- Prisma 7.10.1 with `@prisma/adapter-pg` (PostgreSQL driver adapter).
- Generated Prisma client output: `packages/database/src/generated/client`.
- Migrations: `20261105000000_phase1_foundation`, `20261106000000_phase2_business_operations`.
- Package is consumed by API as a packed local copy: `"@ubos/database": "file:../../packages/database"` with `--install-links`.

## Testing
- API unit tests: Jest 30.0.4 + ts-jest, Node environment, regex `.*\.spec\.ts$`, excluding `*.integration.spec.ts`.
- API integration tests: separate Jest config `jest.integration.config.js`, regex `.*\.integration\.spec\.ts$`, setup file loads `src/load-local-env.ts`.
- Web: no test scripts or test configuration observed.
- Root test command: `npm run build --prefix packages/database && npm test --prefix apps/api`.

## Build and scripts
- Root `package.json` scripts:
  - `dev:api`: build database package, then `start:dev` API.
  - `dev:web`: Next.js dev server.
  - `build`: database package, API, web.
  - `test`: database package, then API unit tests.
- API scripts: `start`, `start:dev`, `build`, `test`, `test:integration`, `test:watch`.
- Database scripts: `generate`, `migrate:dev`, `migrate:deploy`, `build`.
- Web scripts: `dev`, `build`, `start`.

## Configuration and environment
- Root `.env.example` is a reference template for process-level variables and is not loaded automatically.
- API loads `packages/database/.env` via `apps/api/src/load-local-env.ts`.
- Prisma CLI and database client require `DATABASE_URL`.
- Relevant variables observed: `DATABASE_URL`, `API_PORT`, `API_HOST`, `FRONTEND_ORIGIN`, `SESSION_TTL_DAYS`, `NODE_ENV`, `TRUST_PROXY_HOPS`, `NEXT_PUBLIC_API_URL`.
- `.env` and `.env.*` are gitignored except `.env.example`.

## Tooling and generated artifacts
- Generated Prisma client is checked into `packages/database/src/generated`.
- Build outputs (`dist/`, `.next/`, `coverage/`) are gitignored but present locally.
- GSD tooling (`gsd-core/`, `get-shit-done/`, `agents/`, `.clinerules/`) is present in the repository root and is separate from application source.
