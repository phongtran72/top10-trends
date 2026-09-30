import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { PLATFORMS, type SourceDef, type SourceId } from "@/collectors/registry";
import { FRESH_LIST_HOURS, TOP_N } from "@/config/ranking";
import { fetchRuns, rankings, topicItems, trendItems } from "@/db/schema";
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

// Topic ranks in each source's latest successful list from the last three hours.
export async function currentEntries(db: Db, now: Date, hours = FRESH_LIST_HOURS): Promise<ScoreEntry[]> {
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const latest = await db
    .selectDistinctOn([fetchRuns.sourceId, fetchRuns.region], { id: fetchRuns.id })
    .from(fetchRuns)
    .where(and(eq(fetchRuns.status, "ok"), gt(fetchRuns.itemCount, 0), gt(fetchRuns.startedAt, since)))
    .orderBy(fetchRuns.sourceId, fetchRuns.region, desc(fetchRuns.startedAt));
  if (latest.length === 0) return [];
  const rows = await db
    .select({
      topicId: topicItems.topicId,
      sourceId: trendItems.sourceId,
      rank: trendItems.rank,
      metricValue: trendItems.metricValue,
    })
    .from(trendItems)
    .innerJoin(topicItems, eq(topicItems.itemId, trendItems.id))
    .where(
      inArray(
        trendItems.runId,
        latest.map((r) => r.id),
      ),
    );
  return rows.map((r) => ({ ...r, sourceId: r.sourceId as SourceId }));
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
