import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@ubos/database";

type Decimal = Prisma.Decimal;

const MAX_MONEY = new Prisma.Decimal("999999999999.99");

export interface InvoiceLineAmount {
  quantity: number;
  unitPrice: string | Decimal;
}

export function calculateInvoiceAmounts(
  lines: InvoiceLineAmount[],
  taxValue: string | Decimal = "0",
  discountValue: string | Decimal = "0",
) {
  if (lines.length === 0) throw new BadRequestException("An invoice needs at least one line.");

  const subtotal = lines.reduce(
    (sum, line) =>
      sum.plus(new Prisma.Decimal(line.unitPrice).mul(line.quantity).toDecimalPlaces(2)),
    new Prisma.Decimal(0),
  );
  const tax = new Prisma.Decimal(taxValue).toDecimalPlaces(2);
  const discount = new Prisma.Decimal(discountValue).toDecimalPlaces(2);
  if (tax.isNegative() || discount.isNegative() || discount.gt(subtotal)) {
    throw new BadRequestException("Invoice tax and discount must be valid non-negative amounts.");
  }

  const total = subtotal.minus(discount).plus(tax).toDecimalPlaces(2);
  if ([subtotal, tax, discount, total].some((amount) => amount.gt(MAX_MONEY))) {
    throw new BadRequestException("Invoice amounts exceed the supported maximum.");
  }

  return {
    subtotal: subtotal.toDecimalPlaces(2),
    tax,
    discount,
    total,
  };
}

export function outstandingBalance(
  total: Decimal,
  payments: Array<{ amount: Decimal }>,
): Decimal {
  return payments
    .reduce((balance, payment) => balance.minus(payment.amount), total)
    .toDecimalPlaces(2);
}
