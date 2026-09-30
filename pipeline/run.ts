import { describeDatabaseUrl, describeError } from "@/lib/errors";
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
  const url = process.env.SESSION_DATABASE_URL?.trim();
  if (url) console.error(`pipeline: SESSION_DATABASE_URL: ${describeDatabaseUrl(url)}`);
  process.exit(1);
});
