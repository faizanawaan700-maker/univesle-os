import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client/client";

const globalForPrisma = globalThis as typeof globalThis & {
  ubosPrisma?: PrismaClient;
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be configured before the database client is loaded.");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });

export const database =
  globalForPrisma.ubosPrisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.ubosPrisma = database;
}
