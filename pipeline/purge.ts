import { lt } from "drizzle-orm";
import { FETCH_RUN_RETENTION_DAYS, ITEM_RETENTION_DAYS } from "@/config/ranking";
import { fetchRuns, trendItems } from "@/db/schema";
import type { Db } from "./db";

const DAY_MS = 24 * 60 * 60 * 1000;

// Retention (CLAUDE.md invariant 5): trend_items older than 28 days go every
// run, inside YouTube's 30-day limit, and their topic_items and per-platform
// rankings go with them by cascade. fetch_runs are kept 90 days. Topics and
// combined rankings are kept.
export async function purge(db: Db, now: Date): Promise<{ items: number; runs: number }> {
  const itemCutoff = new Date(now.getTime() - ITEM_RETENTION_DAYS * DAY_MS);
  const runCutoff = new Date(now.getTime() - FETCH_RUN_RETENTION_DAYS * DAY_MS);
  const items = await db
    .delete(trendItems)
    .where(lt(trendItems.fetchedAt, itemCutoff))
    .returning({ id: trendItems.id });
  const runs = await db.delete(fetchRuns).where(lt(fetchRuns.startedAt, runCutoff)).returning({ id: fetchRuns.id });
  return { items: items.length, runs: runs.length };
}
