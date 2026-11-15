import { BadRequestException } from "@nestjs/common";
import { ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { database } from "@ubos/database";

jest.mock("@ubos/database", () => ({ database: { $transaction: jest.fn() } }));

import { runIdempotentTransaction, validateIdempotencyKey } from "./idempotency";

describe("validateIdempotencyKey", () => {
  it("accepts printable keys in the documented length range", () => {
    expect(validateIdempotencyKey("1234567890abcdef")).toBe("1234567890abcdef");
    expect(validateIdempotencyKey("k".repeat(128))).toHaveLength(128);
  });

  it.each([undefined, "short", "k".repeat(129), "key with spaces 123"]) (
    "rejects an absent, malformed, or out-of-range key",
    (key) => {
      expect(() => validateIdempotencyKey(key)).toThrow(BadRequestException);
    },
  );
});

describe("runIdempotentTransaction", () => {
  const queryRaw = jest.fn();
  const executeRaw = jest.fn();
  const mockedDatabase = database as jest.Mocked<typeof database>;
  const payload = { method: "cash", amount: "1.00" };
  const requestHash = createHash("sha256")
    .update('{"amount":"1.00","method":"cash"}')
    .digest("hex");

  beforeEach(() => {
    jest.clearAllMocks();
    executeRaw.mockResolvedValue(1);
    mockedDatabase.$transaction.mockImplementation(((callback: (tx: unknown) => unknown) =>
      callback({ $queryRaw: queryRaw, $executeRaw: executeRaw })) as never);
  });

  it("stores the result with the business effect in the same transaction", async () => {
    queryRaw.mockResolvedValueOnce([{ id: "idempotency-1" }]);
    const effect = jest.fn().mockResolvedValue({ id: "payment-1" });

    await expect(runIdempotentTransaction({
      key: "payment-key-0001",
      organizationId: "org-1",
      actorId: "user-1",
      operation: "payments.create",
      payload,
    }, effect)).resolves.toEqual({ id: "payment-1" });

    expect(effect).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(mockedDatabase.$transaction).toHaveBeenCalledTimes(1);
  });

  it("replays a stored response for the same scope and payload", async () => {
    queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ requestHash, responseStatus: 201, responseBody: { id: "payment-1" } }]);
    const effect = jest.fn();

    await expect(runIdempotentTransaction({
      key: "payment-key-0001",
      organizationId: "org-1",
      actorId: "user-1",
      operation: "payments.create",
      payload,
    }, effect)).resolves.toEqual({ id: "payment-1" });

    expect(effect).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("rejects reuse of a key with a different payload", async () => {
    queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ requestHash: "different", responseStatus: 201, responseBody: { id: "payment-1" } }]);
    const effect = jest.fn();

    await expect(runIdempotentTransaction({
      key: "payment-key-0001",
      organizationId: "org-1",
      actorId: "user-1",
      operation: "payments.create",
      payload,
    }, effect)).rejects.toBeInstanceOf(ConflictException);

    expect(effect).not.toHaveBeenCalled();
  });
});
