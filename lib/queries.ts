import { and, asc, desc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import { pageRegion, SOURCES, type SourceDef, type SourceId } from "@/collectors/registry";
import type { Region } from "@/collectors/types";
import { APIFY_FREE_MONTHLY_CREDIT, APIFY_SCHEDULES, CLAUDE_COST_PER_NAME, X_COST_PER_REQUEST } from "@/config/costs";
import { fetchRuns, rankings, topics, trendItems } from "@/db/schema";
import type { Db } from "@/db/types";

// Read-only queries behind the site's pages. Results are plain JSON (dates as
// ISO strings) so they can be cached. Queries run one at a time, as the
// transaction pooler requires.

export interface ListItem {
  rank: number;
  title: string;
  url: string;
  metricValue: number | null;
  metricLabel: string | null;
}

export interface PlatformList {
  sourceId: SourceId;
  region: string;
  fetchedAt: string;
  items: ListItem[];
}

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

// Matches pipeline/score.ts RUN_LIST_MARGIN_MS: how long after a run's rankings
// timestamp its lists may be fetched.
const RANKING_MARGIN_MS = 15 * 60_000;

// A platform's latest successful list for one feed (by default the one its
// page shows first), top 10 in the source's own order (by
// search volume over 3 hours for Google Trends) and after filters when the
// rank step has ranked that list (phase 2); the raw list otherwise.
export async function platformList(db: Db, source: SourceDef, feed?: Region, limit = 10): Promise<PlatformList | null> {
  const region = feed ?? pageRegion(source);
  const [run] = await db
    .select({ id: fetchRuns.id, finishedAt: fetchRuns.finishedAt, startedAt: fetchRuns.startedAt })
    .from(fetchRuns)
    .where(
      and(
        eq(fetchRuns.sourceId, source.id),
        eq(fetchRuns.region, region),
        eq(fetchRuns.status, "ok"),
        gt(fetchRuns.itemCount, 0),
      ),
    )
    .orderBy(desc(fetchRuns.startedAt))
    .limit(1);
  if (!run) return null;
  const fields = {
    title: trendItems.title,
    url: trendItems.url,
    metricValue: trendItems.metricValue,
    metricLabel: trendItems.metricLabel,
  };
  // The filtered list the rank step wrote for that run. A run's rankings are
  // stamped a moment before its lists are fetched; for Google Trends they can
  // include items from earlier runs in its 3-hour window.
  const [latestRanking] = await db
    .select({ at: rankings.computedAt })
    .from(rankings)
    .where(eq(rankings.list, source.id))
    .orderBy(desc(rankings.computedAt))
    .limit(1);
  const ranked =
    latestRanking && latestRanking.at.getTime() >= run.startedAt.getTime() - RANKING_MARGIN_MS
      ? await db
          .select({ rank: rankings.rank, ...fields })
          .from(rankings)
          .innerJoin(trendItems, eq(trendItems.id, rankings.itemId))
          .where(and(eq(rankings.list, source.id), eq(rankings.computedAt, latestRanking.at), eq(trendItems.region, region)))
          .orderBy(asc(rankings.rank))
          .limit(limit)
      : [];
  const items =
    ranked.length > 0
      ? ranked
      : await db
          .select({ rank: trendItems.rank, ...fields })
          .from(trendItems)
          .where(eq(trendItems.runId, run.id))
          .orderBy(asc(trendItems.rank))
          .limit(limit);
  if (items.length === 0) return null;
  return {
    sourceId: source.id,
    region,
    fetchedAt: iso(run.finishedAt ?? run.startedAt)!,
    items,
  };
}

export interface RecentItem extends ListItem {
  runId: number;
  sourceId: string;
  region: string;
  fetchedAt: string;
}

// Every top-10 item fetched since `since` (items exist only for successful
// runs), oldest first. About 1,500 rows for 25 hours of six sources.
export async function recentTopItems(db: Db, since: Date): Promise<RecentItem[]> {
  const rows = await db
    .select({
      runId: trendItems.runId,
      sourceId: trendItems.sourceId,
      region: trendItems.region,
      fetchedAt: trendItems.fetchedAt,
      rank: trendItems.rank,
      title: trendItems.title,
      url: trendItems.url,
      metricValue: trendItems.metricValue,
      metricLabel: trendItems.metricLabel,
    })
    .from(trendItems)
    .where(and(gt(trendItems.fetchedAt, since), lte(trendItems.rank, 10)))
    .orderBy(asc(trendItems.fetchedAt), asc(trendItems.rank));
  return rows.map((row) => ({ ...row, fetchedAt: iso(row.fetchedAt)! }));
}

export interface SourceStatus {
  id: SourceId;
  name: string;
  role: SourceDef["role"];
  phase: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastSuccessAt: string | null;
  lastError: { at: string; message: string } | null;
  runs24h: number;
  ok24h: number;
}

// Per source: last success, last error and the 24-hour success rate. Errors
// in fetch_runs already hold only a status code, host and short reason.
export async function sourceStatuses(db: Db, now: Date): Promise<SourceStatus[]> {
  // An ISO string cast in SQL: postgres-js rejects a Date inside a raw fragment.
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const totals = await db
    .select({
      sourceId: fetchRuns.sourceId,
      runs24h: sql<number>`count(*) filter (where ${fetchRuns.startedAt} > ${since}::timestamptz)`.mapWith(Number),
      ok24h: sql<number>`count(*) filter (where ${fetchRuns.startedAt} > ${since}::timestamptz and ${fetchRuns.status} = 'ok')`.mapWith(
        Number,
      ),
      lastSuccessAt: sql<string | null>`max(coalesce(${fetchRuns.finishedAt}, ${fetchRuns.startedAt})) filter (where ${fetchRuns.status} = 'ok')`,
    })
    .from(fetchRuns)
    .groupBy(fetchRuns.sourceId);
  const latest = await db
    .selectDistinctOn([fetchRuns.sourceId], {
      sourceId: fetchRuns.sourceId,
      startedAt: fetchRuns.startedAt,
      status: fetchRuns.status,
    })
    .from(fetchRuns)
    .orderBy(fetchRuns.sourceId, desc(fetchRuns.startedAt));
  const errors = await db
    .selectDistinctOn([fetchRuns.sourceId], {
      sourceId: fetchRuns.sourceId,
      startedAt: fetchRuns.startedAt,
      error: fetchRuns.error,
    })
    .from(fetchRuns)
    .where(eq(fetchRuns.status, "error"))
    .orderBy(fetchRuns.sourceId, desc(fetchRuns.startedAt));

  return SOURCES.map((source) => {
    const total = totals.find((t) => t.sourceId === source.id);
    const last = latest.find((l) => l.sourceId === source.id);
    const error = errors.find((e) => e.sourceId === source.id);
    return {
      id: source.id,
      name: source.name,
      role: source.role,
      phase: source.phase,
      lastRunAt: iso(last?.startedAt),
      lastStatus: last?.status ?? null,
      lastSuccessAt: iso(total?.lastSuccessAt),
      lastError: error ? { at: iso(error.startedAt)!, message: error.error ?? "unknown error" } : null,
      runs24h: total?.runs24h ?? 0,
      ok24h: total?.ok24h ?? 0,
    };
  });
}

export interface SpendLine {
  service: string;
  detail: string;
  toDate: number; // USD this month so far
  projected: number; // USD for the whole month at the current pace
}

export interface Spend {
  month: string; // "2026-10"
  lines: SpendLine[];
  toDate: number;
  projected: number;
  outOfPocket: number; // projected, less what free plans cover
}

// Month-to-date spend and a projection (TASKS.md 3.7). X is exact: requests
// that reached X × the per-request price. Apify sources are estimates from
// their schedules, since their runs happen on Apify's side. Each source is
// counted from its first run this month, so one that starts mid-month isn't
// charged for the days before it. Claude is an estimate too: the topics it
// named this month × the usual cost of one naming call.
export async function spendThisMonth(db: Db, now: Date): Promise<Spend> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const hour = 60 * 60 * 1000;
  const lines: SpendLine[] = [];

  // How many of a source's runs this month have these statuses, and when the first began.
  const runsSince = async (sourceId: string, statuses: string[]) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number), first: sql<Date | null>`min(${fetchRuns.startedAt})`.mapWith(fetchRuns.startedAt) })
      .from(fetchRuns)
      .where(and(eq(fetchRuns.sourceId, sourceId), inArray(fetchRuns.status, statuses), gte(fetchRuns.startedAt, monthStart)));
    return { n: row.n, first: row.first ? new Date(row.first) : now };
  };

  const x = await runsSince("x", ["ok", "error"]);
  if (x.n > 0) {
    const toDate = x.n * X_COST_PER_REQUEST;
    const elapsedMs = Math.max(now.getTime() - x.first.getTime(), hour);
    lines.push({
      service: "X",
      detail: `${x.n} trend requests × $${X_COST_PER_REQUEST.toFixed(3)}`,
      toDate,
      projected: toDate + (toDate / elapsedMs) * Math.max(monthEnd.getTime() - now.getTime(), 0),
    });
  }

  let apify = 0;
  for (const schedule of APIFY_SCHEDULES) {
    const read = await runsSince(schedule.source, ["ok"]);
    if (read.n === 0) continue;
    const intervalMs = (24 * hour) / schedule.runsPerDay;
    const runsSoFar = Math.floor((now.getTime() - read.first.getTime()) / intervalMs) + 1;
    const runsInMonth = Math.max(Math.ceil((monthEnd.getTime() - read.first.getTime()) / intervalMs), runsSoFar);
    const line = {
      service: schedule.service,
      detail: `about ${runsSoFar} run${runsSoFar === 1 ? "" : "s"} × $${schedule.costPerRun.toFixed(3)}, estimated from the schedule`,
      toDate: runsSoFar * schedule.costPerRun,
      projected: runsInMonth * schedule.costPerRun,
    };
    lines.push(line);
    apify += line.projected;
  }

  const [named] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number), first: sql<Date | null>`min(${topics.firstSeen})`.mapWith(topics.firstSeen) })
    .from(topics)
    .where(and(sql`${topics.name} is not null`, gte(topics.firstSeen, monthStart)));
  if (named.n > 0) {
    const toDate = named.n * CLAUDE_COST_PER_NAME;
    const elapsedMs = Math.max(now.getTime() - (named.first ? new Date(named.first).getTime() : now.getTime()), hour);
    lines.push({
      service: "Claude (topic names)",
      detail: `${named.n} topic${named.n === 1 ? "" : "s"} named × about $${CLAUDE_COST_PER_NAME.toFixed(4)}`,
      toDate,
      projected: toDate + (toDate / elapsedMs) * Math.max(monthEnd.getTime() - now.getTime(), 0),
    });
  }

  const sum = (key: "toDate" | "projected") => lines.reduce((total, line) => total + line[key], 0);
  return {
    month: monthStart.toISOString().slice(0, 7),
    lines,
    toDate: sum("toDate"),
    projected: sum("projected"),
    outOfPocket: sum("projected") - Math.min(apify, APIFY_FREE_MONTHLY_CREDIT),
  };
}
