import { BadRequestException } from "@nestjs/common";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  cursorWhere,
  cursorWhereOn,
  decodeCursor,
  decodeTextCursor,
  encodeCursor,
  encodeTextCursor,
  resolvePageSize,
  textCursorWhere,
  toPage,
  toPageOn,
  toTextPage,
} from "./pagination";

describe("cursor pagination", () => {
  const at = new Date("2026-01-01T10:00:00.000Z");

  it("round-trips a cursor and rejects malformed input", () => {
    const cursor = decodeCursor(encodeCursor(at, "row-1"));
    expect(cursor).toEqual({ createdAt: at, id: "row-1" });
    expect(() => decodeCursor("not-a-cursor")).toThrow(BadRequestException);
    expect(() =>
      decodeCursor(
        Buffer.from(JSON.stringify({ c: "nope", i: "x" })).toString(
          "base64url",
        ),
      ),
    ).toThrow(BadRequestException);
    expect(decodeCursor(undefined)).toBeNull();
  });

  it("bounds the page size", () => {
    expect(resolvePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(resolvePageSize(5)).toBe(5);
    expect(resolvePageSize(10_000)).toBe(MAX_PAGE_SIZE);
    expect(() => resolvePageSize(0)).toThrow(BadRequestException);
  });

  it("returns the first page with a continuation cursor", () => {
    const rows = [
      { id: "a", createdAt: new Date("2026-01-03T00:00:00Z") },
      { id: "b", createdAt: new Date("2026-01-02T00:00:00Z") },
      { id: "c", createdAt: new Date("2026-01-01T00:00:00Z") },
    ];
    const page = toPage(rows, 2);
    expect(page.items.map((row) => row.id)).toEqual(["a", "b"]);
    expect(page.hasMore).toBe(true);
    expect(decodeCursor(page.nextCursor!)).toEqual({
      createdAt: rows[1].createdAt,
      id: "b",
    });
  });

  it("returns a final page without a cursor", () => {
    const page = toPage([{ id: "z", createdAt: at }], 2);
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("keysets rows strictly older than the cursor, including id tiebreaks", () => {
    expect(cursorWhere({ createdAt: at, id: "b" })).toEqual({
      OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: "b" } }],
    });
    expect(cursorWhereOn("paidAt", { createdAt: at, id: "b" })).toEqual({
      OR: [{ paidAt: { lt: at } }, { paidAt: at, id: { lt: "b" } }],
    });
    expect(cursorWhere(null)).toEqual({});
  });

  it("supports an arbitrary timestamp column for the next cursor", () => {
    const rows = [
      { id: "a", paidAt: new Date("2026-02-01T00:00:00Z") },
      { id: "b", paidAt: new Date("2026-01-31T00:00:00Z") },
      { id: "c", paidAt: new Date("2026-01-30T00:00:00Z") },
    ];
    const page = toPageOn(rows, 2, (row) => row.paidAt);
    expect(decodeCursor(page.nextCursor!)?.createdAt).toEqual(rows[1].paidAt);
    expect(
      toPageOn(rows, 2, (row) => row.paidAt).items.map((row) => row.id),
    ).toEqual(["a", "b"]);
  });

  it("paginates text-keyed lists (chart of accounts by code)", () => {
    const cursor = decodeTextCursor(encodeTextCursor("1000", "acc-1"));
    expect(cursor).toEqual({ value: "1000", id: "acc-1" });
    expect(textCursorWhere("code", cursor)).toEqual({
      OR: [{ code: { gt: "1000" } }, { code: "1000", id: { gt: "acc-1" } }],
    });
    const rows = [
      { id: "1", code: "1000" },
      { id: "2", code: "2000" },
      { id: "3", code: "3000" },
    ];
    const page = toTextPage(rows, 2, (row) => row.code);
    expect(page.items.map((row) => row.code)).toEqual(["1000", "2000"]);
    expect(page.hasMore).toBe(true);
    expect(decodeTextCursor(page.nextCursor!)).toEqual({
      value: "2000",
      id: "2",
    });
    expect(() => decodeTextCursor("garbage")).toThrow(BadRequestException);
  });
});
