/**
 * UBOS load baseline (Phase 9 evidence).
 *
 * Registers one throwaway organization, then issues concurrent read requests at a
 * fixed level and reports p50/p95/p99 latency and error counts. Reads only, so it
 * cannot create business data beyond the single test organization.
 *
 * Usage: node docs/scripts/load-baseline.mjs [requests=300] [concurrency=20]
 *        API=http://127.0.0.1:4000 ORIGIN=http://127.0.0.1:3000
 */
const API = process.env.API ?? "http://127.0.0.1:4000";
const ORIGIN = process.env.ORIGIN ?? "http://127.0.0.1:3000";
const total = Number(process.argv[2] ?? 300);
const concurrency = Number(process.argv[3] ?? 20);

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[index];
}

async function register() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(`${API}/auth/register`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        email: `load-${Date.now()}-${attempt}@example.com`,
        password: "load-baseline-password",
        name: "Load Baseline",
        organizationName: `Load Baseline ${Date.now()} ${attempt}`,
      }),
    });
    if (response.status === 201) {
      const body = await response.json();
      return {
        cookie: (response.headers.get("set-cookie") ?? "").split(";")[0],
        organizationId: body.user.organizations[0].id,
      };
    }
    if (response.status !== 429)
      throw new Error(`register failed: ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 21_000));
  }
  throw new Error("registration stayed throttled");
}

const session = await register();
const paths = [
  "/business/products?limit=20",
  "/business/sales?limit=20",
  "/business/customers?limit=20",
  "/business/inventory/movements?limit=20",
  "/business/audit?limit=20",
  "/business/reports/summary",
  "/health/live",
];

const latencies = [];
let errors = 0;
let issued = 0;

async function worker() {
  while (issued < total) {
    issued += 1;
    const path = paths[issued % paths.length];
    const started = performance.now();
    try {
      const response = await fetch(`${API}${path}`, {
        headers: {
          origin: ORIGIN,
          cookie: session.cookie,
          "x-organization-id": session.organizationId,
        },
      });
      if (!response.ok) errors += 1;
      await response.arrayBuffer();
    } catch {
      errors += 1;
    }
    latencies.push(performance.now() - started);
  }
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsed = performance.now() - startedAt;
latencies.sort((a, b) => a - b);

console.log(
  JSON.stringify(
    {
      requests: total,
      concurrency,
      elapsedMs: Math.round(elapsed),
      throughputPerSecond: Math.round((total / elapsed) * 1000),
      latencyMs: {
        p50: Math.round(percentile(latencies, 50)),
        p95: Math.round(percentile(latencies, 95)),
        p99: Math.round(percentile(latencies, 99)),
        max: Math.round(latencies[latencies.length - 1] ?? 0),
      },
      errors,
      errorRate: `${((errors / total) * 100).toFixed(2)}%`,
    },
    null,
    2,
  ),
);
