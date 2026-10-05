import { COLLECTORS } from "@/collectors/index";
import { planSources, unknownSourceIds, type SourceId, type SourcePlan } from "@/collectors/registry";
import type { Collector, Env, TrendItem } from "@/collectors/types";
import { fetchRuns } from "@/db/schema";
import { createEmbedder, type Embedder } from "@/lib/embed";
import { cleanEnv, pipelineEnv, type RawEnv } from "@/lib/env";
import { describeError } from "@/lib/errors";
import { createClaudeNamer } from "@/lib/claude";
import { createHttp } from "@/lib/http";
import { collect, formatResults, writeResults, type ListResult } from "./collect";
import { keepCurves } from "./curves";
import type { Db } from "./db";
import { loadBlocklist } from "./filter";
import { formatNaming, nameTopics, type TopicNamer } from "./naming";
import { purge } from "./purge";
import { formatRankOutcome, rankRun } from "./rank";
import { revalidateSite } from "./revalidate";
import { upsertSources } from "./sources";
import { applyPaidLimits, xRequestsToday } from "./spend";

export interface RunDeps {
  openDb: (url: string) => { db: Db; close: () => Promise<void> };
  log: (line: string) => void;
  now?: () => Date;
  collectors?: ReadonlyMap<SourceId, Collector>;
  fetch?: typeof fetch;
  createEmbedder?: () => Promise<Embedder>;
  blocklist?: ReadonlySet<string>;
  createNamer?: (apiKey: string) => TopicNamer;
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
// then upsert sources, write the lists, keep TikTok's curves, rank the lists
// (filter, embed, match to topics, score), name the top 10s' new topics when
// ANTHROPIC_API_KEY is set, purge old rows, write the heartbeat, ask the site
// to refresh its cached pages and print a summary. A failing source, curves
// step, rank step, naming step or refresh is recorded and never fails the
// run. With --dry-run nothing touches
// the database and paid sources are skipped unless --include-paid is given:
// each list and a combined top 10 from this run alone are printed instead.
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

  // The rank step runs after the lists are saved, in its own try/catch.
  const rank = async (results: ListResult[], db: Db | null, itemIds: Map<TrendItem, number> | null) => {
    try {
      const embedder = await (deps.createEmbedder ?? createEmbedder)();
      const outcome = await rankRun({ db, results, itemIds, now: startedAt, embedder, blocklist: deps.blocklist ?? loadBlocklist() });
      for (const line of formatRankOutcome(outcome)) deps.log(line);
      return outcome.topTopicIds;
    } catch (error) {
      deps.log(`rank: failed: ${describeError(error)}`);
      return [];
    }
  };

  // Claude names the top 10s' topics that have no name yet (task 3.6). Off without a key.
  const name = async (db: Db, topicIds: readonly number[]) => {
    const apiKey = cleanEnv(rawEnv).ANTHROPIC_API_KEY;
    if (!apiKey || topicIds.length === 0) return;
    try {
      const namer = (deps.createNamer ?? createClaudeNamer)(apiKey);
      for (const line of formatNaming(await nameTopics(db, { topicIds, now: startedAt, namer }))) deps.log(line);
    } catch (error) {
      deps.log(`names: failed: ${describeError(error)}`);
    }
  };

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
    if (connection) {
      const { db } = connection;
      await upsertSources(db, plans);
      const itemIds = await writeResults(db, results);
      const curves = await keepCurves(db, results); // never throws
      if (curves) deps.log(curves);
      await name(db, await rank(results, db, itemIds));
      const purged = await purge(db, startedAt);
      if (purged.items > 0 || purged.runs > 0) deps.log(`purged: ${purged.items} items, ${purged.runs} runs`);
      await writeHeartbeat(db, startedAt, now());
    }
  } finally {
    await connection?.close();
  }

  if (env.dryRun) {
    deps.log("sources:");
    for (const line of formatPlan(plans)) deps.log(line);
    for (const line of formatResults(results)) deps.log(line);
    await rank(results, null, null);
  } else {
    for (const result of results) {
      if (result.status === "error") deps.log(`error: ${result.source.id} (${result.region}): ${result.error}`);
    }
    deps.log(await revalidateSite(env.revalidate, deps.fetch));
  }

  deps.log(summarize(plans, results, { dryRun, ms: now().getTime() - startedAt.getTime() }));
}
