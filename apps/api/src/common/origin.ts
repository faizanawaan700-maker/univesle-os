const DEFAULT_FRONTEND_ORIGIN = "http://localhost:3000";

export function normalizeOrigin(value: string | undefined): string {
  try {
    return new URL(value?.trim() || DEFAULT_FRONTEND_ORIGIN).origin;
  } catch {
    throw new Error("FRONTEND_ORIGIN must be a valid absolute URL.");
  }
}
