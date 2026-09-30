import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { siteEnv } from "@/lib/env";

// The website's client, on Supabase's transaction pooler (port 6543): prepared
// statements off, one connection, and queries awaited one at a time.
// Created at first use so `next build` never needs DATABASE_URL.

let db: PostgresJsDatabase<typeof schema> | undefined;

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!db) {
    const client = postgres(siteEnv().DATABASE_URL, { prepare: false, max: 1, ssl: "require" });
    db = drizzle(client, { schema });
  }
  return db;
}
