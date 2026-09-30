import { defineConfig } from "drizzle-kit";
import { loadLocalEnv } from "./lib/local-env";

// `db:generate` needs no database. Migrations are applied by scripts/migrate.ts.
loadLocalEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.SESSION_DATABASE_URL ?? "" },
});
