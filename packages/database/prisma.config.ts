import { defineConfig } from "prisma/config";
import dotenv from "dotenv";
import { resolve } from "node:path";

const localEnv = dotenv.config({
  path: resolve(__dirname, ".env"),
  quiet: true,
});
if (localEnv.error && (localEnv.error as NodeJS.ErrnoException).code !== "ENOENT") {
  throw localEnv.error;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
