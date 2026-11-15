interface UniqueConstraintDescriptor {
  fields: string[];
  index?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readConstraint(value: unknown): UniqueConstraintDescriptor | null {
  if (!isRecord(value)) return null;

  const fields = Array.isArray(value.fields)
    ? value.fields.filter((field): field is string => typeof field === "string")
    : [];
  const index = typeof value.index === "string" ? value.index : undefined;
  if (fields.length === 0 && index === undefined) return null;

  return { fields, index };
}

function readUniqueConstraint(error: unknown): UniqueConstraintDescriptor | null {
  if (!isRecord(error) || error.code !== "P2002") return null;

  const meta = isRecord(error.meta) ? error.meta : undefined;
  if (!meta) return null;

  const target = meta.target;
  if (Array.isArray(target)) {
    return { fields: target.filter((field): field is string => typeof field === "string") };
  }
  if (typeof target === "string") return { fields: [target] };

  const driverError = isRecord(meta.driverAdapterError) ? meta.driverAdapterError : undefined;
  const cause = driverError && isRecord(driverError.cause) ? driverError.cause : undefined;
  return (
    readConstraint(cause?.constraint) ??
    readConstraint(meta.constraint)
  );
}

function constraintMatchesField(
  constraint: UniqueConstraintDescriptor,
  expectedField: string,
): boolean {
  const expected = expectedField.toLowerCase();
  if (constraint.fields.some((field) => field.toLowerCase() === expected)) return true;

  const indexParts = constraint.index
    ?.split(/[^a-zA-Z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
  return indexParts?.includes(expected) ?? false;
}

export function isUniqueConstraintError(
  error: unknown,
  expectedFields: readonly string[] = [],
): boolean {
  if (!isRecord(error) || error.code !== "P2002") return false;
  if (expectedFields.length === 0) return true;

  const constraint = readUniqueConstraint(error);
  if (!constraint) return false;

  return expectedFields.every((field) => constraintMatchesField(constraint, field));
}

export function isRecordNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "P2025";
}

export function isTransactionConflictError(error: unknown): boolean {
  return isRecord(error) && error.code === "P2034";
}

const DEFAULT_RETRY_DELAYS_MS = [25, 100] as const;

export interface TransactionRetryOptions {
  attempts?: number;
  delaysMs?: readonly number[];
  sleep?: (milliseconds: number) => Promise<void>;
}

function sleepFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function retryOnTransactionConflict<T>(
  operation: () => Promise<T>,
  options: TransactionRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delays = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? sleepFor;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransactionConflictError(error) || attempt + 1 >= attempts) {
        throw error;
      }
      const delay = delays[Math.max(0, Math.min(attempt, delays.length - 1))] ?? 0;
      await sleep(delay);
    }
  }
}
