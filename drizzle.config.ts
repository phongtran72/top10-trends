import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// `db:generate` needs no database. Migrations are applied by scripts/migrate.ts.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.SESSION_DATABASE_URL ?? "" },
});
