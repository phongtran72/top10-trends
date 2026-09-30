import { sql } from "drizzle-orm";
import { sources } from "@/db/schema";
import type { SourcePlan } from "@/collectors/registry";
import type { Db } from "./db";

// Upserts the registry into `sources` at the start of each run. `enabled`
// records whether the source runs this hour, so /status can show the rest.
export async function upsertSources(db: Db, plans: readonly SourcePlan[]): Promise<void> {
  const rows = plans.map(({ source, action }) => ({
    id: source.id,
    name: source.name,
    role: source.role,
    weight: source.weight,
    enabled: action === "run",
    regions: [...source.regions],
  }));
  await db
    .insert(sources)
    .values(rows)
    .onConflictDoUpdate({
      target: sources.id,
      set: {
        name: sql`excluded.name`,
        role: sql`excluded.role`,
        weight: sql`excluded.weight`,
        enabled: sql`excluded.enabled`,
        regions: sql`excluded.regions`,
      },
    });
}
