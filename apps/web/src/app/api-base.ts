"use client";

/**
 * Single source of truth for the API base URL.
 *
 * The deployed API origin comes from `NEXT_PUBLIC_API_URL`. Same-origin "/api"
 * is supported for deployments that reverse-proxy the API, which keeps the
 * session cookie on the web origin. The last fallback is the local API.
 */
export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_API_SAME_ORIGIN === "1"
  ) {
    return `${window.location.origin}/api`;
  }
  // Same hostname, different port keeps the Lax session cookie same-site and
  // works identically whether the page was opened as localhost or 127.0.0.1.
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return "http://localhost:4000";
}
