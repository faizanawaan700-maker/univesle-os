import dotenv from "dotenv";
import { resolve } from "node:path";

// Load environment from the app's directory (apps/api), NOT packages/database.
// This matches the real runtime location of .env when running via
// `npm run start:dev` from apps/api or the root build script.
const localEnv = dotenv.config({
  path: resolve(__dirname, "..", ".env"),
  quiet: true,
});
if (localEnv.error && (localEnv.error as NodeJS.ErrnoException).code !== "ENOENT") {
  throw localEnv.error;
}
