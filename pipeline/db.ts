import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

export type { Db } from "@/db/types";

// The pipeline's client, on Supabase's session pooler (port 5432). Never the
// direct host: it is IPv6-only and GitHub's runners are IPv4-only.
export function createPipelineDb(url: string) {
  const client = postgres(url, { max: 1, ssl: "require", onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}
