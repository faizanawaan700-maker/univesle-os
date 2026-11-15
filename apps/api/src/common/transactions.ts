import { database } from "@ubos/database";
import type { Prisma } from "@ubos/database";
import { retryOnTransactionConflict } from "./prisma-errors";

export function runTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return retryOnTransactionConflict(() => database.$transaction(operation));
}
