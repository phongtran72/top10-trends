import { and, eq, isNotNull, lt, ne } from "drizzle-orm";
import {
  CENTROID_RETENTION_DAYS,
  COMBINED_RANKING_RETENTION_DAYS,
  FETCH_RUN_RETENTION_DAYS,
  ITEM_RETENTION_DAYS,
  PLATFORM_RANKING_RETENTION_DAYS,
} from "@/config/ranking";
import { fetchRuns, rankings, topics, trendItems } from "@/db/schema";
import type { Db } from "./db";

const DAY_MS = 24 * 60 * 60 * 1000;

// Retention (CLAUDE.md invariant 5): trend_items older than 28 days go every
// run, inside YouTube's 30-day limit, and their topic_items go with them by
// cascade. fetch_runs are kept 90 days. Rankings, which only the site reads,
// are kept 2 days per platform and 7 days combined (task 4.16). Topics are
// kept, but a topic's centroid is cleared once it hasn't been seen for 7 days
// (task 4.15): only matching reads it, for topics seen in the last 48 hours.
export async function purge(db: Db, now: Date): Promise<{ items: number; runs: number; rankings: number; centroids: number }> {
  const itemCutoff = new Date(now.getTime() - ITEM_RETENTION_DAYS * DAY_MS);
  const runCutoff = new Date(now.getTime() - FETCH_RUN_RETENTION_DAYS * DAY_MS);
  const items = await db
    .delete(trendItems)
    .where(lt(trendItems.fetchedAt, itemCutoff))
    .returning({ id: trendItems.id });
  const runs = await db.delete(fetchRuns).where(lt(fetchRuns.startedAt, runCutoff)).returning({ id: fetchRuns.id });
  const platformRankings = await db
    .delete(rankings)
    .where(and(ne(rankings.list, "combined"), lt(rankings.computedAt, new Date(now.getTime() - PLATFORM_RANKING_RETENTION_DAYS * DAY_MS))))
    .returning({ id: rankings.id });
  const combinedRankings = await db
    .delete(rankings)
    .where(and(eq(rankings.list, "combined"), lt(rankings.computedAt, new Date(now.getTime() - COMBINED_RANKING_RETENTION_DAYS * DAY_MS))))
    .returning({ id: rankings.id });
  const centroidCutoff = new Date(now.getTime() - CENTROID_RETENTION_DAYS * DAY_MS);
  const centroids = await db
    .update(topics)
    .set({ centroid: null })
    .where(and(lt(topics.lastSeen, centroidCutoff), isNotNull(topics.centroid)))
    .returning({ id: topics.id });
  return {
    items: items.length,
    runs: runs.length,
    rankings: platformRankings.length + combinedRankings.length,
    centroids: centroids.length,
  };
}
