import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { pageRegion, SOURCES, type SourceDef, type SourceId } from "@/collectors/registry";
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
