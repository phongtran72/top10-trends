import { pipelineEnv } from "@/lib/env";
import { describeError } from "@/lib/errors";
import { loadLocalEnv } from "@/lib/local-env";
import { createPipelineDb } from "@/pipeline/db";
import { describeMissing, formatHealth, listStates, missingLists } from "@/pipeline/health";

// The missing-list alarm (task 4.13): reads fetch_runs and exits 1 when a list
// has been missing for 6 hours or more, or the hourly update has stopped, so
// the `health` workflow fails and GitHub emails the owner. Read-only.
//   npm run health [-- --test-alarm]
// --test-alarm fails on purpose after the check, to see that the email arrives.

async function main() {
  loadLocalEnv();
  const testAlarm = process.argv.slice(2).includes("--test-alarm");
  const env = pipelineEnv({ dryRun: false });
  const { db, close } = createPipelineDb(env.SESSION_DATABASE_URL);
  const now = new Date();
  let missing: ReturnType<typeof missingLists>;
  try {
    const states = await db.transaction((tx) => listStates(tx, now), { accessMode: "read only" });
    missing = missingLists(states, now);
    for (const line of formatHealth(states, missing, now)) console.log(line);
  } finally {
    await close();
  }
  // In GitHub Actions each missing list also becomes an annotation on the run.
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const list of missing) console.log(`::error title=Missing list::${describeMissing(list)}`);
  }
  if (testAlarm) {
    console.log("health: --test-alarm: failing on purpose, so GitHub sends its email");
    process.exit(1);
  }
  if (missing.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(`health: failed: ${describeError(error)}`);
  process.exit(1);
});
