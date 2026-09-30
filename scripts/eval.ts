import { describeError } from "@/lib/errors";
import { pipelineEnv } from "@/lib/env";
import { loadLocalEnv } from "@/lib/local-env";
import { createPipelineDb } from "@/pipeline/db";
import { evalHour, formatEvalHour, sampleHours } from "@/pipeline/eval";

// npm run eval -- --hours 5: prints the combined top 10 of 5 random past
// hours (from the last 7 days) with each topic's member items and score, for
// the phase 2 review (TASKS.md Gate 2). Also runs as the `eval` workflow.

function hoursArg(argv: readonly string[]): number {
  const index = argv.indexOf("--hours");
  if (index === -1) return 5;
  const hours = Number(argv[index + 1]);
  if (!Number.isInteger(hours) || hours < 1 || hours > 48) throw new Error("--hours must be a whole number from 1 to 48");
  return hours;
}

async function main() {
  loadLocalEnv();
  const hours = hoursArg(process.argv.slice(2));
  const env = pipelineEnv({ dryRun: false });
  const { db, close } = createPipelineDb(env.SESSION_DATABASE_URL);
  try {
    const times = await sampleHours(db, hours, new Date());
    if (times.length === 0) console.log("eval: no combined rankings in the last 7 days yet");
    for (const at of times) for (const line of formatEvalHour(await evalHour(db, at))) console.log(line);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(`eval: failed: ${describeError(error)}`);
  process.exit(1);
});
