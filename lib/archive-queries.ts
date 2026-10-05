import { and, asc, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { getSource, pageRegion, platformSlug, SOURCES, type SourceId } from "@/collectors/registry";
import { DEFAULT_VIEW, type View } from "@/config/ranking";
import { rankings, topics, trendItems } from "@/db/schema";
import type { Db } from "@/db/types";
import { PLATFORM_ROWS_REGION } from "@/pipeline/score";

// Queries behind /archive (task 4.1): past combined top 10s, hour by hour, and
// each platform's list for an hour while its items are still stored (28
// days). Days are UTC days. Plain JSON results, so they can be cached.

const DAY_MS = 24 * 60 * 60 * 1000;

// "2026-10-04" → that UTC day's start, or null for anything that isn't a real date.
export function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const start = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== value ? null : start;
}

export interface ArchiveDaySummary {
  date: string; // YYYY-MM-DD, UTC
  lists: number; // hourly combined top 10s that day
}

// Every UTC day that has a combined top 10, newest first.
export async function archiveDays(db: Db): Promise<ArchiveDaySummary[]> {
  const day = sql<string>`to_char(${rankings.computedAt} at time zone 'utc', 'YYYY-MM-DD')`;
  const rows = await db
    .select({ date: day, lists: sql<number>`count(distinct ${rankings.computedAt})`.mapWith(Number) })
    .from(rankings)
    .where(and(eq(rankings.list, "combined"), eq(rankings.region, DEFAULT_VIEW)))
    .groupBy(day)
    .orderBy(desc(day));
  return rows;
}

export interface ArchiveEntry {
  rank: number;
  slug: string;
  label: string;
}

export interface ArchiveList {
  at: string; // when the list was computed
  entries: ArchiveEntry[];
}

// One view's combined top 10s computed on a UTC day, oldest first.
export async function archiveDay(db: Db, date: string, view: View = DEFAULT_VIEW): Promise<ArchiveList[]> {
  const start = parseDay(date);
  if (!start) return [];
  const rows = await db
    .select({ at: rankings.computedAt, rank: rankings.rank, slug: topics.slug, label: topics.label, name: topics.name })
    .from(rankings)
    .innerJoin(topics, eq(topics.id, rankings.topicId))
    .where(
      and(
        eq(rankings.list, "combined"),
        eq(rankings.region, view),
        gte(rankings.computedAt, start),
        lt(rankings.computedAt, new Date(start.getTime() + DAY_MS)),
      ),
    )
    .orderBy(asc(rankings.computedAt), asc(rankings.rank));
  const lists = new Map<number, ArchiveList>();
  for (const row of rows) {
    const list = lists.get(row.at.getTime()) ?? { at: row.at.toISOString(), entries: [] };
    list.entries.push({ rank: row.rank, slug: row.slug, label: row.name ?? row.label });
    lists.set(row.at.getTime(), list);
  }
  return [...lists.values()];
}

export interface ArchivePlatformList {
  sourceId: SourceId;
  name: string;
  slug: string;
  feed: string;
  items: { rank: number; title: string; url: string }[];
}

const known = new Set<string>(SOURCES.map((s) => s.id));

// Each platform's filtered top 10 as it stood in one run, for the feed its
// page shows first, in the site's platform order. Empty once the run's items
// have been purged (28 days).
export async function archivePlatformLists(db: Db, at: string): Promise<ArchivePlatformList[]> {
  const rows = await db
    .select({ list: rankings.list, rank: rankings.rank, title: trendItems.title, url: trendItems.url, feed: trendItems.region })
    .from(rankings)
    .innerJoin(trendItems, eq(trendItems.id, rankings.itemId))
    .where(and(ne(rankings.list, "combined"), eq(rankings.region, PLATFORM_ROWS_REGION), eq(rankings.computedAt, new Date(at))))
    .orderBy(asc(rankings.rank));
  const lists = new Map<SourceId, ArchivePlatformList>();
  for (const row of rows) {
    if (!known.has(row.list)) continue;
    const source = getSource(row.list as SourceId);
    if (row.feed !== pageRegion(source)) continue;
    const list = lists.get(source.id) ?? { sourceId: source.id, name: source.name, slug: platformSlug(source.id), feed: row.feed, items: [] };
    list.items.push({ rank: row.rank, title: row.title, url: row.url });
    lists.set(source.id, list);
  }
  return SOURCES.flatMap((source) => lists.get(source.id) ?? []);
}
