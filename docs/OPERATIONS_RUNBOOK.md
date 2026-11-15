# UBOS Operations Runbook

Operational procedures for deploying, monitoring, backing up and rolling back
UBOS. Nothing here has been executed against a production environment; each step
records what must be verified before a production readiness claim is made.

## 1. Deployment order

The API and database must move together in this order:

1. **Back up** (see §4). Record the migration version currently applied.
2. **Apply migrations**: `npm run migrate:deploy --prefix packages/database`.
   Migrations in this repository are additive; they create tables, indexes and
   foreign keys and do not drop or rewrite business rows.
3. **Deploy the API** (`npm start --prefix apps/api`) and wait for
   `GET /health/ready` to answer `200 { status: "ready" }`.
4. **Deploy the web client** (`npm start --prefix apps/web`) built with the
   production `NEXT_PUBLIC_API_URL`.
5. **Smoke test**: sign-in, create a product, record a sale, open Analytics.

Required environment for the API:

| Variable                | Purpose                                      | Notes                                              |
| ----------------------- | -------------------------------------------- | -------------------------------------------------- |
| `DATABASE_URL`          | PostgreSQL connection                        | Never commit; inject via the platform secret store |
| `FRONTEND_ORIGIN`       | Exact browser origin allowed to mutate       | Must match the deployed web origin                 |
| `API_HOST` / `API_PORT` | Listen address                               | Use the hostname the browser will call             |
| `COOKIE_DOMAIN`         | Share the session cookie across subdomains   | Hostname only, no scheme or port                   |
| `NODE_ENV=production`   | Enables secure cookies                       | HTTPS is mandatory                                 |
| `TRUST_PROXY_HOPS`      | Proxy depth for client IPs and rate limiting | Set to the real number of proxies                  |

`COOKIE_SAME_SITE=none` exists for an API on a _different site_ than the web
client and is rejected unless `NODE_ENV=production` (secure cookies required).

## 2. Health and monitoring

| Endpoint            | Meaning                              | Action on failure                                        |
| ------------------- | ------------------------------------ | -------------------------------------------------------- |
| `GET /health/live`  | Process is up                        | Restart the container/task                               |
| `GET /health/ready` | Database reachable (`503` when down) | Remove from the load balancer, page the on-call engineer |

Wire `/health/ready` to the orchestrator's readiness probe and `/health/live` to
its liveness probe. Alert if readiness is `503` for more than two minutes.

## 3. Graceful shutdown

The API handles `SIGTERM` and `SIGINT`: it stops accepting work, closes the
Nest application, disconnects the Prisma pool and exits `0`. A 15-second watchdog
forces exit `1` if shutdown hangs. Configure the platform's termination grace
period to at least 20 seconds.

## 4. Backup and restore

Backups must be encrypted at rest and stored outside the database host.

```powershell
# Backup (custom format, compressed) -- Phase 9 scripts
# The scripts read DATABASE_URL (NOT UBOS_DATABASE_URL). The API loads it from
# packages/database/.env via dotenv; a separate PowerShell process does not
# inherit that, so export it into this process first, without echoing it.
$env:PGPASSWORD = '<from secret store>'   # required: server enforces SCRAM-SHA-256

# Bootstrap DATABASE_URL from the existing local env file (no secrets printed)
$envLine = Get-Content packages\database\.env | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
$env:DATABASE_URL = (($envLine -split '=',2)[1]).Trim().Trim('"').Trim("'")

.\scripts\pg-backup-phase9.ps1

# Restore verification into a THROWAWAY, uniquely named database, never production
.\scripts\pg-restore-verify-phase9.ps1 -ArchivePath .\backups\backup_ubos_development_<timestamp>.backup
```

`pg-restore-verify-phase9.ps1` creates a cryptographically random
`ubos_verify_<timestamp>_<32 hex>` database, **never** restores into
`ubos_development` or its own source database, and **never drops** the
verification database. It reports the exact name so a later, separately
approved cleanup can target it. Automatic deletion is intentionally disabled.

Archive ACLs: the backup script protects each archive file (inheritance off)
and grants FullControl to exactly three SID-based principals — the current
operator, `BUILTIN\Administrators` (S-1-5-32-544) and `NT AUTHORITY\SYSTEM`
(S-1-5-18). The operator grant is required: a normal developer account is not
an Administrators member and would otherwise be locked out of its own archive.

After restoring, verify:

- row counts for `Organization`, `Sale`, `Payment`, `StockMovement`
- `SELECT SUM("total") FROM "Sale"` matches the pre-backup figure
- `_prisma_migrations` shows the same applied versions as production

### Automated drill

Phase 9 uses two scripts under `scripts/`:

| Script | Purpose |
|---|---|
| `scripts/pg-backup-phase9.ps1` | `pg_dump -Fc` to a unique archive, `pg_restore -l` verification, ACL hardening |
| `scripts/pg-restore-verify-phase9.ps1` | Restores into a unique temporary database and verifies schema + row counts |

`docs/scripts/backup-restore.ps1` is the earlier single-file drill helper
(`-Mode backup` / `-Mode verify`, scratch name `<database>_restore_check`). It
is retained but is **not** the Phase 9 path.

Acceptance criteria are distinct and must not be conflated:

1. Backup created (exit 0, non-zero archive).
2. Backup archive readable by the operator.
3. Archive independently listable (`pg_restore -l`, exit 0, non-empty TOC).
4. Restore completed into the temporary database.
5. Restored data reconciled against source counts/totals.
6. Recovery drill passed (all of the above, on a recorded date).

**Recorded result (2026-11-08, local `ubos_development`): PASSED** for criteria
1–6 using `docs/scripts/backup-restore.ps1` — organizations, users, sales,
payments, stock movements, sales total and applied migrations all matched.

**Recorded result (2026-11-13): criteria 1 only.** A 777,480-byte archive was
produced by the Phase 9 backup script with exit 0. Criteria 2–6 were NOT met for
that archive at the time of writing, and no restore of it has been performed.

**RPO/RTO: UNAGREED.** No recovery time or recovery point objective has been
approved. Nothing here proves a recovery time target.

## 5. Rollback

1. Roll back the **application** first (previous container image). Schema changes
   are additive, so the previous API version continues to work.
2. Do **not** run `prisma migrate reset` or `db push` on a shared database.
3. If a migration must be undone, write a **new forward migration** that reverses
   its effect; never edit an applied migration.
4. Restore a backup only when data is corrupted, and only after the incident
   owner approves.

## 5b. Observability

Every request produces one JSON log line on stdout:

```json
{"level":"info","type":"http_request","requestId":"...","method":"GET","path":"/business/sales","status":200,"durationMs":12.4,"timestamp":"..."}
```

- `x-request-id` is returned on every response; a safe caller-supplied id is
  reused, an unsafe one is replaced. Use it to correlate client reports with logs.
- Logged: method, path, status, duration, level. **Not logged:** query strings,
  request bodies, cookies, session tokens, headers or financial values.
- Ship stdout to the log platform; alert on `level=error` rate and on p95
  `durationMs`.

### Load baseline (2026-11-08, local machine, single API instance)

`node docs/scripts/load-baseline.mjs 300 20` — read-only traffic across list,
report and health endpoints:

| Metric | Value |
|---|---|
| Requests / concurrency | 300 / 20 |
| Throughput | ~67 req/s |
| p50 / p95 / p99 | 133 ms / 438 ms / 966 ms |
| Errors | 0 (0.00%) |

This is a local baseline for regression comparison, not a capacity target. Data
volumes are small and no caching layer is involved.

## 6. Rate limiting and throttling

- Registration and login are limited to 8 requests per minute per IP (anti-abuse).
- Global limit: 120 requests per minute.
- Automated test suites that create many accounts must wait for the window
  instead of raising the limit (`e2e/run-e2e.ps1` and the integration helpers do).

## 7. Release checklist

- [ ] `npm run build` passes (database, API, web)
- [ ] `npm test` passes
- [ ] Integration suite passes against an ephemeral database
- [ ] Browser acceptance suite passes
- [ ] `npx prisma migrate status` reports no pending migrations after deploy
- [ ] `/health/ready` returns `200` in the target environment
- [ ] Backup taken and restore drill current
- [ ] Rollback image identified and tested
- [ ] Named operational owner recorded for the release
