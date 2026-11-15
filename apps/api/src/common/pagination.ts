/**
 * Cursor pagination helpers (Phase 3).
 *
 * Cursors are opaque base64url-encoded JSON `{ createdAt, id }` pairs. Ordering
 * is always `createdAt DESC, id DESC` so pages are stable even when many rows
 * share a timestamp. A cursor is only ever produced by this module, and any
 * malformed cursor is rejected rather than silently ignored.
 */
import { BadRequestException } from "@nestjs/common";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export type Cursor = { createdAt: Date; id: string };

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ c: createdAt.toISOString(), i: id }),
    "utf8",
  ).toString("base64url");
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new BadRequestException("Invalid pagination cursor.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { c?: unknown }).c !== "string" ||
    typeof (parsed as { i?: unknown }).i !== "string"
  ) {
    throw new BadRequestException("Invalid pagination cursor.");
  }
  const createdAt = new Date((parsed as { c: string }).c);
  if (Number.isNaN(createdAt.getTime())) {
    throw new BadRequestException("Invalid pagination cursor.");
  }
  return { createdAt, id: (parsed as { i: string }).i };
}

export function resolvePageSize(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new BadRequestException("Page size must be a positive integer.");
  }
  return Math.min(limit, MAX_PAGE_SIZE);
}

/**
 * Builds a Prisma `where` fragment for keyset pagination on `createdAt DESC, id DESC`.
 * Rows strictly older than the cursor are returned.
 */
export function cursorWhere(cursor: Cursor | null) {
  if (!cursor) return {};
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

/**
 * Converts a fetched page (size + 1) into a `Page` with a next cursor.
 * `cursorField` names the timestamp column used for keyset ordering; it
 * defaults to `createdAt` but some models (e.g. Payment) use another column.
 */
export function toPage<T extends { id: string }>(
  rows: T[],
  pageSize: number,
  cursorField: keyof T = "createdAt" as keyof T,
): Page<T> {
  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  const last = items[items.length - 1];
  const lastDate = last ? (last[cursorField] as unknown as Date) : undefined;
  return {
    items,
    hasMore,
    nextCursor: hasMore && last && lastDate ? encodeCursor(lastDate, last.id) : null,
  };
}

/**
 * Keyset pagination for lists ordered by a caller-selected timestamp column
 * (for example `StockMovement.createdAt` or `JournalEntry.postedAt`). The same
 * opaque cursor format is reused so clients only learn one continuation model.
 */
export function cursorWhereOn(
  column: string,
  cursor: Cursor | null,
): Record<string, unknown> {
  if (!cursor) return {};
  return {
    OR: [
      { [column]: { lt: cursor.createdAt } },
      { [column]: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

/** Ascending keyset fragment; used for stable code/name ordered lists. */
export function cursorWhereAscendingOn(
  column: string,
  cursor: Cursor | null,
): Record<string, unknown> {
  if (!cursor) return {};
  return {
    OR: [
      { [column]: { gt: cursor.createdAt } },
      { [column]: cursor.createdAt, id: { gt: cursor.id } },
    ],
  };
}

/**
 * Like `toPage`, but reads the cursor timestamp from any date column instead of
 * `createdAt`. Used by lists ordered on `paidAt`, `postedAt`, `updatedAt`, etc.
 */
export function toPageOn<T extends { id: string }>(
  rows: T[],
  pageSize: number,
  readDate: (row: T) => Date | null | undefined,
): Page<T> {
  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  const last = items[items.length - 1];
  const lastDate = last ? readDate(last) : undefined;
  return {
    items,
    hasMore,
    nextCursor: hasMore && last && lastDate ? encodeCursor(lastDate, last.id) : null,
  };
}

/** String-keyed variant of the cursor pair, for code/name ordered lists. */
export function encodeTextCursor(value: string, id: string): string {
  return Buffer.from(JSON.stringify({ s: value, i: id }), "utf8").toString("base64url");
}

export function decodeTextCursor(raw: string | undefined): { value: string; id: string } | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new BadRequestException("Invalid pagination cursor.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { s?: unknown }).s !== "string" ||
    typeof (parsed as { i?: unknown }).i !== "string"
  ) {
    throw new BadRequestException("Invalid pagination cursor.");
  }
  return { value: (parsed as { s: string }).s, id: (parsed as { i: string }).i };
}

/** Keyset fragment for lists ordered ascending by a unique text column + id. */
export function textCursorWhere(
  column: string,
  cursor: { value: string; id: string } | null,
): Record<string, unknown> {
  if (!cursor) return {};
  return {
    OR: [
      { [column]: { gt: cursor.value } },
      { [column]: cursor.value, id: { gt: cursor.id } },
    ],
  };
}

export function toTextPage<T extends { id: string }>(
  rows: T[],
  pageSize: number,
  readKey: (row: T) => string,
): Page<T> {
  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeTextCursor(readKey(last), last.id) : null,
  };
}
