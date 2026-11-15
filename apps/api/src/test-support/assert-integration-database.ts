const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const REQUIRED_DATABASE = "ubos_development";

export function assertIntegrationDatabase(): void {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Set DATABASE_URL to the dedicated local ubos_development PostgreSQL database.");
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !LOCAL_HOSTS.has(url.hostname) ||
    databaseName !== REQUIRED_DATABASE
  ) {
    throw new Error("Integration tests require the local ubos_development PostgreSQL database.");
  }
}
