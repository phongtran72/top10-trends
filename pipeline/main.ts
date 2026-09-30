import { planSources, unknownSourceIds, type SourceId, type SourcePlan } from "@/collectors/registry";
import { fetchRuns } from "@/db/schema";
import { pipelineEnv, type RawEnv } from "@/lib/env";
import type { Db } from "./db";
import { upsertSources } from "./sources";

// Collectors built so far. Phase 1 fills this from the collector modules.
export const COLLECTORS: ReadonlySet<SourceId> = new Set<SourceId>();

export interface RunDeps {
  openDb: (url: string) => { db: Db; close: () => Promise<void> };
  log: (line: string) => void;
  now?: () => Date;
  collectors?: ReadonlySet<SourceId>;
}

export function parseArgs(argv: readonly string[]): { dryRun: boolean } {
  const unknown = argv.filter((arg) => arg !== "--dry-run");
  if (unknown.length > 0) throw new Error(`unknown argument: ${unknown.join(" ")} (only --dry-run is supported)`);
  return { dryRun: argv.includes("--dry-run") };
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

export function summarize(plans: readonly SourcePlan[], options: { dryRun: boolean; ms: number }): string {
  const count = (action: SourcePlan["action"]) =>
    plans.filter((p) => p.action === action && p.source.role !== "system").length;
  const parts = [
    options.dryRun ? "dry run: nothing written" : "run ok: heartbeat written",
    `${count("run")} sources run`,
    `${count("skip")} skipped`,
    `${count("absent")} not built yet`,
  ];
  return `${parts.join(", ")} (${options.ms} ms)`;
}

// One pipeline run: upsert sources, write the heartbeat, print a summary.
// With --dry-run nothing touches the database.
export async function runPipeline(argv: readonly string[], rawEnv: RawEnv, deps: RunDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const { dryRun } = parseArgs(argv);
  const env = pipelineEnv({ dryRun }, rawEnv);
  const plans = planSources({
    collectors: deps.collectors ?? COLLECTORS,
    disabled: env.DISABLED_SOURCES,
    env: rawEnv,
  });

  const unknown = unknownSourceIds(env.DISABLED_SOURCES);
  if (unknown.length > 0) deps.log(`warning: DISABLED_SOURCES has unknown ids: ${unknown.join(", ")}`);

  if (env.dryRun) {
    deps.log("sources:");
    for (const line of formatPlan(plans)) deps.log(line);
  } else {
    const { db, close } = deps.openDb(env.SESSION_DATABASE_URL);
    try {
      await upsertSources(db, plans);
      await writeHeartbeat(db, startedAt, now());
    } finally {
      await close();
    }
  }

  deps.log(summarize(plans, { dryRun, ms: now().getTime() - startedAt.getTime() }));
}
