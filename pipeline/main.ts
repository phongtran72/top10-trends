import { COLLECTORS } from "@/collectors/index";
import { planSources, unknownSourceIds, type SourceId, type SourcePlan } from "@/collectors/registry";
import type { Collector, Env } from "@/collectors/types";
import { fetchRuns } from "@/db/schema";
import { cleanEnv, pipelineEnv, type RawEnv } from "@/lib/env";
import { createHttp } from "@/lib/http";
import { collect, formatResults, writeResults, type ListResult } from "./collect";
import type { Db } from "./db";
import { purge } from "./purge";
import { applyPaidLimits, xRequestsToday } from "./spend";
import { revalidateSite } from "./revalidate";
import { upsertSources } from "./sources";

export interface RunDeps {
  openDb: (url: string) => { db: Db; close: () => Promise<void> };
  log: (line: string) => void;
  now?: () => Date;
  collectors?: ReadonlyMap<SourceId, Collector>;
  fetch?: typeof fetch;
}

export function parseArgs(argv: readonly string[]): { dryRun: boolean; includePaid: boolean } {
  const known = ["--dry-run", "--include-paid"];
  const unknown = argv.filter((arg) => !known.includes(arg));
  if (unknown.length > 0) throw new Error(`unknown argument: ${unknown.join(" ")} (supported: ${known.join(", ")})`);
  return { dryRun: argv.includes("--dry-run"), includePaid: argv.includes("--include-paid") };
}

export async function writeHeartbeat(db: Db, startedAt: Date, finishedAt: Date): Promise<void> {
  await db.insert(fetchRuns).values({
    sourceId: "heartbeat",
    region: "global",
    startedAt,
    finishedAt,
    status: "ok",
    itemCount: 0,
  });
}

export function formatPlan(plans: readonly SourcePlan[]): string[] {
  const width = Math.max(...plans.map((p) => p.source.id.length));
  return plans.map((p) => {
    const reason = p.action === "run" ? "" : `  ${p.reason}`;
    return `  ${p.source.id.padEnd(width)}  ${p.action.padEnd(6)}${reason}`.trimEnd();
  });
}

export function summarize(
  plans: readonly SourcePlan[],
  results: readonly ListResult[],
  options: { dryRun: boolean; ms: number },
): string {
  const lists = (status: ListResult["status"]) => results.filter((r) => r.status === status).length;
  const absent = plans.filter((p) => p.action === "absent").length;
  const parts = [
    options.dryRun ? "dry run: nothing written" : "run ok: heartbeat written",
    `${lists("ok")} lists ok`,
    `${lists("error")} failed`,
    `${lists("skipped")} skipped`,
    `${absent} sources not built yet`,
  ];
  return `${parts.join(", ")} (${options.ms} ms)`;
}

// One pipeline run: check paid-source limits, collect every enabled source,
// then upsert sources, write the lists, purge old rows, write the heartbeat,
// ask the site to refresh its cached pages and print a summary. A failing
// source or refresh is recorded and never fails the run. With --dry-run
// nothing touches the database and paid sources are skipped unless
// --include-paid is given: each list is printed instead.
export async function runPipeline(argv: readonly string[], rawEnv: RawEnv, deps: RunDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const { dryRun, includePaid } = parseArgs(argv);
  const env = pipelineEnv({ dryRun }, rawEnv);
  const collectors = deps.collectors ?? COLLECTORS;
  const planned = planSources({
    collectors: new Set(collectors.keys()),
    disabled: env.DISABLED_SOURCES,
    env: rawEnv,
  });

  const unknown = unknownSourceIds(env.DISABLED_SOURCES);
  if (unknown.length > 0) deps.log(`warning: DISABLED_SOURCES has unknown ids: ${unknown.join(", ")}`);

  // A full run opens the database first, to check X's daily cap before collecting.
  const connection = env.dryRun ? null : deps.openDb(env.SESSION_DATABASE_URL);
  let plans: SourcePlan[] = planned;
  let results: ListResult[];
  try {
    plans = applyPaidLimits(planned, {
      dryRun,
      includePaid,
      xRequestsToday: connection ? await xRequestsToday(connection.db, startedAt) : null,
    });
    const collectorEnv: Env = { ...cleanEnv(rawEnv), MASTODON_INSTANCE: env.MASTODON_INSTANCE };
    const http = createHttp({ userAgent: env.COLLECTOR_USER_AGENT, fetch: deps.fetch });
    results = await collect(plans, collectors, { http, env: collectorEnv, now: startedAt }, { now });
    if (connection) await writeRun(connection.db, plans, results, startedAt, now, deps.log);
  } finally {
    await connection?.close();
  }

  if (env.dryRun) {
    deps.log("sources:");
    for (const line of formatPlan(plans)) deps.log(line);
    for (const line of formatResults(results)) deps.log(line);
  } else {
    for (const result of results) {
      if (result.status === "error") deps.log(`error: ${result.source.id} (${result.region}): ${result.error}`);
    }
    deps.log(await revalidateSite(env.revalidate, deps.fetch));
  }

  deps.log(summarize(plans, results, { dryRun, ms: now().getTime() - startedAt.getTime() }));
}

// Saves one full run: sources, lists, purge and the heartbeat.
async function writeRun(
  db: Db,
  plans: readonly SourcePlan[],
  results: readonly ListResult[],
  startedAt: Date,
  now: () => Date,
  log: (line: string) => void,
): Promise<void> {
  await upsertSources(db, plans);
  await writeResults(db, results);
  const purged = await purge(db, startedAt);
  if (purged.items > 0 || purged.runs > 0) log(`purged: ${purged.items} items, ${purged.runs} runs`);
  await writeHeartbeat(db, startedAt, now());
}
