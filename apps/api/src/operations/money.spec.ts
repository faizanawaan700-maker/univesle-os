jest.mock("@ubos/database", () => ({
  Prisma: {
    Decimal: jest.requireActual("@prisma/client/runtime/client").Decimal,
  },
}));

import { Decimal } from "@prisma/client/runtime/client";
import { calculateInvoiceAmounts, outstandingBalance } from "./money";

describe("precise invoice money", () => {
  it("calculates subtotals, discounts, tax and balances with decimal arithmetic", () => {
    const amounts = calculateInvoiceAmounts(
      [
        { quantity: 3, unitPrice: "0.10" },
        { quantity: 2, unitPrice: "1.25" },
      ],
      "0.07",
      "0.02",
    );

    expect(amounts.subtotal.toFixed(2)).toBe("2.80");
    expect(amounts.total.toFixed(2)).toBe("2.85");
    expect(
      outstandingBalance(new Decimal("2.85"), [
        { amount: new Decimal("1.10") },
      ]).toFixed(2),
    ).toBe("1.75");
  });

  it("rejects invoice totals that exceed the database decimal range", () => {
    expect(() =>
      calculateInvoiceAmounts([{ quantity: 2, unitPrice: "999999999999.99" }]),
    ).toThrow("Invoice amounts exceed the supported maximum.");
  });
});
