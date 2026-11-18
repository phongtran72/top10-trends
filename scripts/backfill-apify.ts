import { COLLECTORS } from "@/collectors";
import { getSource } from "@/collectors/registry";
import { cleanEnv, pipelineEnv } from "@/lib/env";
import { describeError } from "@/lib/errors";
import { createHttp, type Http } from "@/lib/http";
import { loadLocalEnv } from "@/lib/local-env";
import { APIFY_ACTORS, listApifyRuns, missedHours, pinnedHttp, recoverHour, runAt, type ApifyRun } from "@/pipeline/backfill";
import { keepCurves } from "@/pipeline/curves";
import { createPipelineDb } from "@/pipeline/db";

// Recovers the lists the Apify-backed sources missed (task 4.12): every
// instagram, tiktok and pinterest hour in [--from, --to) that failed with
// Apify's 401 gets the list a live run would have read then. Without --write
// it only prints what it would store. Runs from the backfill-apify workflow,
// which has the token:
//   npm run backfill-apify -- --from 2026-11-12T09:00Z --to 2026-11-18T21:00Z [--write]

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

function time(argv: readonly string[], name: string): Date {
  const value = option(argv, name);
  const at = value ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(at.getTime())) throw new Error(`--${name} needs a UTC time, for example 2026-11-12T09:00Z`);
  return at;
}

// Hours that read the same Apify run share its dataset, so each is fetched once.
function memoHttp(http: Http): Http {
  const seen = new Map<string, Promise<unknown>>();
  return {
    getJson: (url, options) => {
      if (!seen.has(url)) seen.set(url, http.getJson(url, options));
      return seen.get(url)!;
    },
    getXml: (url, options) => http.getXml(url, options),
    postFormJson: (url, form, options) => http.postFormJson(url, form, options),
  };
}

async function main() {
  loadLocalEnv();
  const argv = process.argv.slice(2);
  const from = time(argv, "from");
  const to = time(argv, "to");
  const write = argv.includes("--write");
  const env = pipelineEnv({ dryRun: false });
  const collectorEnv = cleanEnv(process.env);
  const token = collectorEnv.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is missing (SETUP.md §12 step 2)");
  const http = memoHttp(createHttp({ userAgent: env.COLLECTOR_USER_AGENT }));
  const { db, close } = createPipelineDb(env.SESSION_DATABASE_URL);
  const log = (line: string) => console.log(`backfill: ${line}`);
  try {
    const hours = await missedHours(db, from, to);
    log(`${hours.length} failed hours from ${from.toISOString()} to ${to.toISOString()}${write ? "" : " (print only; add --write to store)"}`);
    const runs = new Map<string, ApifyRun[]>();
    const tally = new Map<string, { hours: number; items: number; missing: number }>();
    for (const hour of hours) {
      const actor = APIFY_ACTORS[hour.sourceId]!;
      if (!runs.has(actor)) runs.set(actor, await listApifyRuns(http, token, actor));
      const run = runAt(runs.get(actor)!, hour.startedAt);
      const key = `${hour.sourceId}/${hour.region}`;
      const counts = tally.get(key) ?? { hours: 0, items: 0, missing: 0 };
      tally.set(key, counts);
      const when = hour.startedAt.toISOString().slice(0, 16);
      if (!run) {
        counts.missing += 1;
        log(`${when} ${key}: Apify no longer has a run from before then; left as it is`);
        continue;
      }
      const collector = COLLECTORS.get(hour.sourceId)!;
      const items = await collector.fetch(hour.region, { http: pinnedHttp(http, actor, run), env: collectorEnv, now: hour.startedAt });
      log(`${when} ${key}: ${items.length} items from the run that finished ${run.finishedAt.toISOString().slice(0, 16)}`);
      if (!write) continue;
      const stored = await recoverHour(db, hour, items);
      counts.hours += stored > 0 ? 1 : 0;
      counts.items += stored;
      // TikTok's daily curves, as the live run would have kept them (the first hour that saw each one).
      if (hour.sourceId === "tiktok" && stored > 0) {
        const curves = await keepCurves(db, [
          { source: getSource("tiktok"), region: hour.region, status: "ok", items, startedAt: hour.startedAt, finishedAt: hour.finishedAt },
        ]);
        if (curves) log(`${when} ${key}: ${curves}`);
      }
    }
    for (const [key, counts] of tally) {
      log(`${key}: ${write ? `${counts.hours} hours recovered, ${counts.items} items stored` : "printed only"}; ${counts.missing} hours Apify no longer has`);
    }
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(`backfill: failed: ${describeError(error)}`);
  process.exit(1);
});
