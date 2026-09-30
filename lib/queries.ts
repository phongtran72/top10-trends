import { and, asc, desc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import { pageRegion, SOURCES, type SourceDef, type SourceId } from "@/collectors/registry";
import {
  APIFY_FREE_MONTHLY_CREDIT,
  TIKTOK_COST_PER_RUN,
  TIKTOK_RUN_EVERY_DAYS,
  X_COST_PER_REQUEST,
} from "@/config/costs";
import { fetchRuns, trendItems } from "@/db/schema";
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

// A platform's latest successful list, top 10 in the source's own order.
export async function platformList(db: Db, source: SourceDef, limit = 10): Promise<PlatformList | null> {
  const region = pageRegion(source);
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
  const items = await db
    .select({
      rank: trendItems.rank,
      title: trendItems.title,
      url: trendItems.url,
      metricValue: trendItems.metricValue,
      metricLabel: trendItems.metricLabel,
    })
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
// that reached X × the per-request price. TikTok is an estimate from the Apify
// schedule, since its runs happen on Apify's side.
export async function spendThisMonth(db: Db, now: Date): Promise<Spend> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const elapsedMs = Math.max(now.getTime() - monthStart.getTime(), 60 * 60 * 1000);
  const monthMs = monthEnd.getTime() - monthStart.getTime();
  const lines: SpendLine[] = [];

  const [x] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(fetchRuns)
    .where(and(eq(fetchRuns.sourceId, "x"), inArray(fetchRuns.status, ["ok", "error"]), gte(fetchRuns.startedAt, monthStart)));
  if (x.n > 0) {
    const toDate = x.n * X_COST_PER_REQUEST;
    lines.push({
      service: "X",
      detail: `${x.n} trend requests × $${X_COST_PER_REQUEST.toFixed(3)}`,
      toDate,
      projected: (toDate / elapsedMs) * monthMs,
    });
  }

  const [tiktok] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(fetchRuns)
    .where(and(eq(fetchRuns.sourceId, "tiktok"), eq(fetchRuns.status, "ok"), gte(fetchRuns.startedAt, monthStart)));
  if (tiktok.n > 0) {
    const day = 24 * 60 * 60 * 1000;
    const runsSoFar = Math.floor(elapsedMs / (TIKTOK_RUN_EVERY_DAYS * day)) + 1;
    const runsInMonth = Math.ceil(monthMs / (TIKTOK_RUN_EVERY_DAYS * day));
    lines.push({
      service: "TikTok (Apify)",
      detail: `about ${runsSoFar} runs × $${TIKTOK_COST_PER_RUN.toFixed(3)}, estimated from the schedule`,
      toDate: runsSoFar * TIKTOK_COST_PER_RUN,
      projected: runsInMonth * TIKTOK_COST_PER_RUN,
    });
  }

  const sum = (key: "toDate" | "projected") => lines.reduce((total, line) => total + line[key], 0);
  const apify = lines.find((l) => l.service.startsWith("TikTok"))?.projected ?? 0;
  return {
    month: monthStart.toISOString().slice(0, 7),
    lines,
    toDate: sum("toDate"),
    projected: sum("projected"),
    outOfPocket: sum("projected") - Math.min(apify, APIFY_FREE_MONTHLY_CREDIT),
  };
}
