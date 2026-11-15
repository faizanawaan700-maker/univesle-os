import {
  isRecordNotFoundError,
  isTransactionConflictError,
  isUniqueConstraintError,
  retryOnTransactionConflict,
} from "./prisma-errors";

describe("isUniqueConstraintError", () => {
  it("recognizes the legacy Prisma meta.target shape", () => {
    const error = {
      code: "P2002",
      meta: { target: ["organizationId", "invoiceNumber"] },
    };

    expect(isUniqueConstraintError(error)).toBe(true);
    expect(isUniqueConstraintError(error, ["invoiceNumber"])).toBe(true);
    expect(isUniqueConstraintError(error, ["email"])).toBe(false);
  });

  it("recognizes Prisma 7 driver adapter constraint names", () => {
    const error = {
      code: "P2002",
      meta: {
        driverAdapterError: {
          cause: {
            kind: "UniqueConstraintViolation",
            constraint: { index: "PurchaseInvoice_organizationId_invoiceNumber_key" },
          },
        },
      },
    };

    expect(isUniqueConstraintError(error, ["invoiceNumber"])).toBe(true);
    expect(isUniqueConstraintError(error, ["email"])).toBe(false);
  });

  it("recognizes Prisma 7 driver adapter constraint fields", () => {
    const error = {
      code: "P2002",
      meta: {
        driverAdapterError: {
          cause: {
            kind: "UniqueConstraintViolation",
            constraint: { fields: ["email"] },
          },
        },
      },
    };

    expect(isUniqueConstraintError(error, ["email"])).toBe(true);
    expect(isUniqueConstraintError(error, ["invoiceNumber"])).toBe(false);
  });

  it("does not treat other Prisma errors as unique constraint conflicts", () => {
    expect(isUniqueConstraintError({ code: "P2025" })).toBe(false);
    expect(isUniqueConstraintError(new Error("failed"))).toBe(false);
  });
});

describe("Prisma error classification", () => {
  it("recognizes missing records and transaction conflicts", () => {
    expect(isRecordNotFoundError({ code: "P2025" })).toBe(true);
    expect(isRecordNotFoundError({ code: "P2034" })).toBe(false);
    expect(isTransactionConflictError({ code: "P2034" })).toBe(true);
    expect(isTransactionConflictError({ code: "P2025" })).toBe(false);
  });
});

describe("retryOnTransactionConflict", () => {
  it("retries only transaction conflicts and eventually succeeds", async () => {
    const sleep = jest.fn(async (_milliseconds: number) => undefined);
    let attempts = 0;
    const result = await retryOnTransactionConflict(
      async () => {
        attempts += 1;
        if (attempts < 3) throw { code: "P2034" };
        return "ok";
      },
      { sleep },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([25, 100]);
  });

  it("does not retry non-conflict errors", async () => {
    const sleep = jest.fn(async (_milliseconds: number) => undefined);
    let attempts = 0;
    const failure = { code: "P2025" };

    await expect(
      retryOnTransactionConflict(
        async () => {
          attempts += 1;
          throw failure;
        },
        { sleep },
      ),
    ).rejects.toBe(failure);
    expect(attempts).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("stops after the configured number of attempts", async () => {
    const sleep = jest.fn(async (_milliseconds: number) => undefined);
    let attempts = 0;
    const failure = { code: "P2034" };

    await expect(
      retryOnTransactionConflict(
        async () => {
          attempts += 1;
          throw failure;
        },
        { attempts: 3, sleep },
      ),
    ).rejects.toBe(failure);
    expect(attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
