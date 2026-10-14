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

// Runs the site's database reads one after another. The layout's banner and
// the page fill their caches at the same moment after each hourly refresh,
// and reads that overlap on the one pooled connection can stop answering for
// good (seen on 2026-10-13: the source statuses beside a platform's list;
// PLAN.md › Tech stack). A read that fails doesn't hold up the next one.
let queue: Promise<unknown> = Promise.resolve();

export function oneAtATime<T>(read: () => Promise<T>): Promise<T> {
  const result = queue.then(read);
  queue = result.catch(() => undefined);
  return result;
}
