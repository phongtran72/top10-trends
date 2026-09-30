import { migrate } from "drizzle-orm/postgres-js/migrator";
import { pipelineEnv } from "@/lib/env";
import { describeError } from "@/lib/errors";
import { loadLocalEnv } from "@/lib/local-env";
import { createPipelineDb } from "@/pipeline/db";

// Applies db/migrations to SESSION_DATABASE_URL (the session pooler).
async function main() {
  loadLocalEnv();
  const env = pipelineEnv({ dryRun: false });
  const { db, close } = createPipelineDb(env.SESSION_DATABASE_URL);
  try {
    await migrate(db, { migrationsFolder: "db/migrations" });
    console.log("migrate: done");
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(`migrate: failed: ${describeError(error)}`);
  process.exit(1);
});
