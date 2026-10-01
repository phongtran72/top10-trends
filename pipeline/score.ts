import { and, desc, eq, gt, inArray, lte, notInArray } from "drizzle-orm";
import { PLATFORMS, type SourceDef, type SourceId } from "@/collectors/registry";
import { BLUESKY_GRACE_HOURS, FRESH_LIST_HOURS, TOP_N, UNSCORED_SOURCES } from "@/config/ranking";
import { fetchRuns, rankings, topicItems, trendItems } from "@/db/schema";
import { rankWindow, WINDOWED_SOURCES } from "@/lib/window";
import type { Db } from "./db";

// Combined score (CLAUDE.md invariant 7): the sum over platforms of
// weight / log2(best rank + 1). A corroborating platform counts only when a
// lead platform also has the topic, and only lists fetched in the last three
// hours count.

export interface ScoreEntry {
  topicId: number;
  sourceId: SourceId;
  rank: number;
  metricValue?: number | null;
  // For the eval tool: what the entry is and where it came from.
  title?: string;
  region?: string;
  via?: "window" | "grace"; // not from the source's latest list
}

export interface TopicScore {
  topicId: number;
  score: number;
  platforms: { sourceId: SourceId; rank: number }[]; // best rank per platform, counted or not
}

export function scoreTopics(entries: readonly ScoreEntry[], sources: readonly SourceDef[] = PLATFORMS): TopicScore[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const best = new Map<number, Map<SourceId, number>>();
  for (const { topicId, sourceId, rank } of entries) {
    if (!byId.has(sourceId)) continue;
    const ranks = best.get(topicId) ?? new Map<SourceId, number>();
    ranks.set(sourceId, Math.min(rank, ranks.get(sourceId) ?? Infinity));
    best.set(topicId, ranks);
  }

  const scores: TopicScore[] = [];
  for (const [topicId, ranks] of best) {
    const hasLead = [...ranks.keys()].some((id) => byId.get(id)!.role === "lead");
    if (!hasLead) continue;
    let score = 0;
    for (const [sourceId, rank] of ranks) score += byId.get(sourceId)!.weight / Math.log2(rank + 1);
    // Best rank first; ties by weight, then id, so the order is stable.
    const platforms = [...ranks]
      .map(([sourceId, rank]) => ({ sourceId, rank }))
      .sort(
        (a, b) =>
          a.rank - b.rank || byId.get(b.sourceId)!.weight - byId.get(a.sourceId)!.weight || a.sourceId.localeCompare(b.sourceId),
      );
    scores.push({ topicId, score, platforms });
  }
  return scores.sort(
    (a, b) => b.score - a.score || a.platforms[0].rank - b.platforms[0].rank || a.topicId - b.topicId,
  );
}

// A run stamps its rankings with its own start time and fetches its lists a
// moment later, so lists up to this long after that time belong to it.
export const RUN_LIST_MARGIN_MS = 15 * 60_000;

export interface WindowRow {
  itemId: number;
  topicId: number;
  region: string;
  title: string;
  metricValue: number | null;
  rank: number; // 1-based, within its region's window
  fetchedAt: Date;
}

// A windowed source's kept items (those matched to a topic) from every
// successful list in the last `hours`, ranked per region by rankWindow.
export async function windowedItems(db: Db, sourceId: SourceId, now: Date, hours: number): Promise<WindowRow[]> {
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const until = new Date(now.getTime() + RUN_LIST_MARGIN_MS);
  const rows = await db
    .select({
      itemId: trendItems.id,
      topicId: topicItems.topicId,
      region: trendItems.region,
      title: trendItems.title,
      metricValue: trendItems.metricValue,
      rank: trendItems.rank,
      fetchedAt: trendItems.fetchedAt,
    })
    .from(trendItems)
    .innerJoin(topicItems, eq(topicItems.itemId, trendItems.id))
    .innerJoin(fetchRuns, eq(fetchRuns.id, trendItems.runId))
    .where(
      and(
        eq(trendItems.sourceId, sourceId),
        eq(fetchRuns.status, "ok"),
        gt(fetchRuns.startedAt, since),
        lte(fetchRuns.startedAt, until),
      ),
    );
  const byRegion = new Map<string, typeof rows>();
  for (const row of rows) byRegion.set(row.region, [...(byRegion.get(row.region) ?? []), row]);
  return [...byRegion.values()].flatMap((regionRows) => rankWindow(regionRows).map((row, index) => ({ ...row, rank: index + 1 })));
}

// Sources whose topics keep counting for a while after they drop out of the
// latest list, at the rank they were last seen with.
export const GRACE_SOURCES: ReadonlyMap<SourceId, number> = new Map([["bluesky", BLUESKY_GRACE_HOURS]]);

// Topic ranks in each source's latest successful list from the last three
// hours; a windowed source (Google Trends) ranks every list in its window
// instead, and a grace source (Bluesky) adds topics it listed in the last
// couple of hours at their last rank. The upper bound matters when replaying
// past hours.
export async function currentEntries(db: Db, now: Date, hours = FRESH_LIST_HOURS): Promise<ScoreEntry[]> {
  const windowed: ScoreEntry[] = [];
  for (const [sourceId, windowHours] of WINDOWED_SOURCES) {
    const rows = await windowedItems(db, sourceId, now, windowHours);
    // Marked "window" only when the item has already left the source's latest list.
    const newest = new Map<string, number>();
    for (const row of rows) newest.set(row.region, Math.max(newest.get(row.region) ?? 0, row.fetchedAt.getTime()));
    for (const row of rows) {
      const left = row.fetchedAt.getTime() < newest.get(row.region)!;
      windowed.push({ topicId: row.topicId, sourceId, rank: row.rank, metricValue: row.metricValue, title: row.title, region: row.region, via: left ? "window" : undefined });
    }
  }
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const until = new Date(now.getTime() + RUN_LIST_MARGIN_MS);
  const latest = await db
    .selectDistinctOn([fetchRuns.sourceId, fetchRuns.region], { id: fetchRuns.id, sourceId: fetchRuns.sourceId })
    .from(fetchRuns)
    .where(
      and(
        eq(fetchRuns.status, "ok"),
        gt(fetchRuns.itemCount, 0),
        gt(fetchRuns.startedAt, since),
        lte(fetchRuns.startedAt, until),
        // Windowed sources are added above; unscored ones never count.
        notInArray(fetchRuns.sourceId, [...WINDOWED_SOURCES.keys(), ...UNSCORED_SOURCES]),
      ),
    )
    .orderBy(fetchRuns.sourceId, fetchRuns.region, desc(fetchRuns.startedAt));
  if (latest.length === 0) return windowed;
  const rows = await db
    .select({
      topicId: topicItems.topicId,
      sourceId: trendItems.sourceId,
      rank: trendItems.rank,
      metricValue: trendItems.metricValue,
      title: trendItems.title,
      region: trendItems.region,
    })
    .from(trendItems)
    .innerJoin(topicItems, eq(topicItems.itemId, trendItems.id))
    .where(
      inArray(
        trendItems.runId,
        latest.map((r) => r.id),
      ),
    );
  const entries: ScoreEntry[] = rows.map((r) => ({ ...r, sourceId: r.sourceId as SourceId }));

  const graced: ScoreEntry[] = [];
  for (const [sourceId, graceHours] of GRACE_SOURCES) {
    const present = new Set(entries.filter((e) => e.sourceId === sourceId).map((e) => e.topicId));
    // Grace is for a topic that dropped out of the source's list. One that is
    // still listed but was filtered (Bluesky now calls it stale) gets none.
    const latestIds = latest.filter((run) => run.sourceId === sourceId).map((run) => run.id);
    const listed = new Set(
      latestIds.length === 0
        ? []
        : (await db.select({ url: trendItems.url }).from(trendItems).where(inArray(trendItems.runId, latestIds))).map((row) => row.url),
    );
    const earlier = await db
      .select({
        topicId: topicItems.topicId,
        rank: trendItems.rank,
        metricValue: trendItems.metricValue,
        title: trendItems.title,
        region: trendItems.region,
        url: trendItems.url,
      })
      .from(trendItems)
      .innerJoin(topicItems, eq(topicItems.itemId, trendItems.id))
      .innerJoin(fetchRuns, eq(fetchRuns.id, trendItems.runId))
      .where(
        and(
          eq(trendItems.sourceId, sourceId),
          eq(fetchRuns.status, "ok"),
          gt(fetchRuns.startedAt, new Date(now.getTime() - graceHours * 60 * 60 * 1000)),
          lte(fetchRuns.startedAt, until),
        ),
      )
      .orderBy(desc(fetchRuns.startedAt), trendItems.rank);
    // Newest sighting first, so each missing topic keeps the rank it was last seen with.
    for (const { url, ...row } of earlier) {
      if (present.has(row.topicId)) continue;
      present.add(row.topicId);
      if (listed.has(url)) continue;
      graced.push({ ...row, sourceId, via: "grace" });
    }
  }
  return [...entries, ...graced, ...windowed];
}

export interface PlatformRow {
  sourceId: SourceId;
  rank: number;
  itemId: number;
  topicId: number | null;
}

// Writes the combined top 10 and each platform's top 10 for one run. Until
// phase 3 adds a US view, every ranking is the `global` view.
export async function writeRankings(
  db: Db,
  computedAt: Date,
  combined: readonly TopicScore[],
  platforms: readonly PlatformRow[],
  region = "global",
): Promise<void> {
  const rows = [
    ...combined.slice(0, TOP_N).map((topic, index) => ({
      computedAt,
      list: "combined",
      region,
      rank: index + 1,
      topicId: topic.topicId,
      itemId: null,
      score: topic.score,
    })),
    ...platforms.map((row) => ({
      computedAt,
      list: row.sourceId,
      region,
      rank: row.rank,
      topicId: row.topicId,
      itemId: row.itemId,
      score: null,
    })),
  ];
  if (rows.length > 0) await db.insert(rankings).values(rows);
}
