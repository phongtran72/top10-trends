import { describeError } from "@/lib/errors";
import { loadLocalEnv } from "@/lib/local-env";
import { createPipelineDb } from "./db";
import { runPipeline } from "./main";

// Entry point for `npm run pipeline [-- --dry-run]`, run hourly by
// .github/workflows/collect.yml.
loadLocalEnv();
runPipeline(process.argv.slice(2), process.env, {
  openDb: createPipelineDb,
  log: (line) => console.log(line),
}).catch((error: unknown) => {
  console.error(`pipeline failed: ${describeError(error)}`);
  process.exit(1);
});
