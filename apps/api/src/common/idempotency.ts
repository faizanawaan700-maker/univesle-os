import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@ubos/database";
import { runTransaction } from "./transactions";

export type IdempotencyScope = {
  key: string | undefined;
  organizationId: string;
  actorId: string;
  operation: string;
  payload: unknown;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

export function validateIdempotencyKey(key: string | undefined): string {
  if (!key || key.length < 16 || key.length > 128 || !/^[\x21-\x7E]+$/.test(key)) {
    throw new BadRequestException("Idempotency-Key must contain 16 to 128 printable ASCII characters.");
  }
  return key;
}

export async function runIdempotentTransaction<T>(
  scope: IdempotencyScope,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const key = validateIdempotencyKey(scope.key);
  const keyHash = createHash("sha256").update(key).digest("hex");
  const requestHash = createHash("sha256").update(stableJson(scope.payload)).digest("hex");
  return runTransaction(async (tx) => {
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "IdempotencyRecord"
        ("id", "organizationId", "actorId", "operation", "keyHash", "requestHash", "createdAt")
      VALUES
        (${randomUUID()}, ${scope.organizationId}, ${scope.actorId}, ${scope.operation}, ${keyHash}, ${requestHash}, CURRENT_TIMESTAMP)
      ON CONFLICT ("organizationId", "actorId", "operation", "keyHash") DO NOTHING
      RETURNING "id"
    `;

    if (inserted.length === 0) {
      const existing = await tx.$queryRaw<Array<{ requestHash: string; responseStatus: number | null; responseBody: unknown }>>`
        SELECT "requestHash", "responseStatus", "responseBody"
        FROM "IdempotencyRecord"
        WHERE "organizationId" = ${scope.organizationId}
          AND "actorId" = ${scope.actorId}
          AND "operation" = ${scope.operation}
          AND "keyHash" = ${keyHash}
      `;
      const record = existing[0];
      if (!record || record.requestHash !== requestHash) {
        throw new ConflictException("Idempotency-Key was already used for a different request.");
      }
      if (record.responseStatus === null || record.responseBody === null) {
        throw new ConflictException("The request with this Idempotency-Key is still being processed.");
      }
      return record.responseBody as T;
    }

    const result = await operation(tx);
    const responseBody = JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
    await tx.$executeRaw`
      UPDATE "IdempotencyRecord"
      SET "responseStatus" = 201, "responseBody" = ${JSON.stringify(responseBody)}::jsonb
      WHERE "organizationId" = ${scope.organizationId}
        AND "actorId" = ${scope.actorId}
        AND "operation" = ${scope.operation}
        AND "keyHash" = ${keyHash}
    `;
    return result;
  });
}
