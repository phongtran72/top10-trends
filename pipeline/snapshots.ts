import { PLATFORMS, type SourceId } from "@/collectors/registry";
import { RANKING_VERSION } from "@/config/ranking";
import { topicSnapshots } from "@/db/schema";
import { EMBEDDING_DIMENSIONS, EMBEDDING_DTYPE, EMBEDDING_MODEL } from "@/lib/embed";
import type { Db } from "./db";
import { bestEntries, scoreTopics, type ScoreEntry } from "./score";

// Topic snapshots: one row per topic per run, kept permanently as history for
// a future prediction model. Built from the same current entries as the
// combined score.
//
// YouTube is left out entirely. Its developer policies (III.E.4) allow
// storing API data for at most 30 days and forbid using it "to create new or
// derived data or metrics", so neither its ranks nor its view counts go into
// a permanent table, and it doesn't count toward the snapshot score.
export const EXCLUDED_FROM_HISTORY: ReadonlySet<SourceId> = new Set<SourceId>(["youtube"]);

// How a snapshot was made, e.g. "nomic-embed-text-v1.5.q8.384/t0.86/r2": the
// embedding model, weights and dimensions, the matching threshold and the
// ranking version, plus
// "+replay" for hours rebuilt from stored lists (which read what was stored at
// the time: no Bluesky status before 2026-10-01 15:07 UTC, and titles only, no
// headlines, before match text was stored on 2026-10-02).
export function algoVersion(threshold: number, replay = false): string {
  const model = EMBEDDING_MODEL.split("/").pop()!.toLowerCase();
  return `${model}.${EMBEDDING_DTYPE}.${EMBEDDING_DIMENSIONS}/t${threshold.toFixed(2)}/${RANKING_VERSION}${replay ? "+replay" : ""}`;
}

export interface SnapshotRow {
  takenAt: Date;
  region: string;
  topicId: number;
  position: number | null;
  score: number | null;
  platformCount: number;
  newsCount: number;
  algoVersion: string;
  ranks: Record<string, number>;
  metrics: Record<string, number>;
}

export function buildSnapshots(
  entries: readonly ScoreEntry[],
  takenAt: Date,
  options: { algoVersion: string; newsCount?: ReadonlyMap<number, number>; region?: string },
): SnapshotRow[] {
  const region = options.region ?? "global";
  const kept = entries.filter((e) => !EXCLUDED_FROM_HISTORY.has(e.sourceId));
  const sources = PLATFORMS.filter((p) => !EXCLUDED_FROM_HISTORY.has(p.id));
  const scores = scoreTopics(kept, sources);
  const position = new Map(scores.map((s, index) => [s.topicId, { position: index + 1, score: s.score }]));

  // Each platform's rank for the topic, the one the score uses, with that item's metric.
  return [...bestEntries(kept, sources)]
    .map(([topicId, platforms]) => {
      const ranks: Record<string, number> = {};
      const metrics: Record<string, number> = {};
      for (const [sourceId, entry] of platforms) {
        ranks[sourceId] = entry.rank;
        if (entry.metricValue !== null && entry.metricValue !== undefined) metrics[sourceId] = entry.metricValue;
      }
      const scored = position.get(topicId);
      return {
        takenAt,
        region,
        topicId,
        position: scored?.position ?? null,
        score: scored?.score ?? null,
        platformCount: platforms.size,
        newsCount: options.newsCount?.get(topicId) ?? 0,
        algoVersion: options.algoVersion,
        ranks,
        metrics,
      };
    })
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.topicId - b.topicId);
}

export async function writeSnapshots(db: Db, rows: readonly SnapshotRow[]): Promise<void> {
  if (rows.length > 0) await db.insert(topicSnapshots).values([...rows]).onConflictDoNothing();
}
