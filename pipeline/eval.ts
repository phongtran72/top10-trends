import { and, asc, desc, eq, gt, inArray, lte } from "drizzle-orm";
import { FRESH_LIST_HOURS } from "@/config/ranking";
import { fetchRuns, rankings, topicItems, topics, trendItems } from "@/db/schema";
import type { Db } from "./db";

// Evaluation (TASKS.md 2.8): print the combined top 10 of a few past hours
// with each topic's member items and score, for a person to judge whether at
// least 8 of 10 topics make sense and none is a duplicate.

export interface EvalTopic {
  rank: number;
  label: string;
  score: number;
  members: { sourceId: string; rank: number; title: string }[];
}

export interface EvalHour {
  at: Date;
  topics: EvalTopic[];
}

// Up to `count` distinct combined-ranking times from the last `days`, chosen at random.
export async function sampleHours(db: Db, count: number, now: Date, days = 7, random = Math.random): Promise<Date[]> {
  const since = new Date(now.getTime() - days * 24 * 3_600_000);
  const rows = await db
    .selectDistinct({ at: rankings.computedAt })
    .from(rankings)
    .where(and(eq(rankings.list, "combined"), gt(rankings.computedAt, since)))
    .orderBy(desc(rankings.computedAt));
  const times = rows.map((r) => r.at);
  for (let i = times.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [times[i], times[j]] = [times[j], times[i]];
  }
  return times.slice(0, count).sort((a, b) => a.getTime() - b.getTime());
}

// One hour's combined top 10 with the items that made up each topic then:
// its items in each source's latest list from the three hours before. A run
// stamps its rankings with its own start time and fetches its lists a moment
// later, so lists up to 15 minutes after that time belong to it.
export async function evalHour(db: Db, at: Date, region = "global"): Promise<EvalHour> {
  const top = await db
    .select({ rank: rankings.rank, topicId: rankings.topicId, score: rankings.score, label: topics.label })
    .from(rankings)
    .innerJoin(topics, eq(topics.id, rankings.topicId))
    .where(and(eq(rankings.list, "combined"), eq(rankings.region, region), eq(rankings.computedAt, at)))
    .orderBy(asc(rankings.rank));

  const since = new Date(at.getTime() - FRESH_LIST_HOURS * 3_600_000);
  const runs = await db
    .selectDistinctOn([fetchRuns.sourceId, fetchRuns.region], { id: fetchRuns.id })
    .from(fetchRuns)
    .where(and(eq(fetchRuns.status, "ok"), gt(fetchRuns.startedAt, since), lte(fetchRuns.startedAt, new Date(at.getTime() + 15 * 60_000))))
    .orderBy(fetchRuns.sourceId, fetchRuns.region, desc(fetchRuns.startedAt));
  const topicIds = top.map((t) => t.topicId!).filter((id) => id !== null);
  const members =
    runs.length === 0 || topicIds.length === 0
      ? []
      : await db
          .select({ topicId: topicItems.topicId, sourceId: trendItems.sourceId, rank: trendItems.rank, title: trendItems.title })
          .from(topicItems)
          .innerJoin(trendItems, eq(trendItems.id, topicItems.itemId))
          .where(
            and(
              inArray(topicItems.topicId, topicIds),
              inArray(
                trendItems.runId,
                runs.map((r) => r.id),
              ),
            ),
          )
          .orderBy(asc(trendItems.rank));

  return {
    at,
    topics: top.map((t) => ({
      rank: t.rank,
      label: t.label,
      score: t.score ?? 0,
      members: members.filter((m) => m.topicId === t.topicId).map(({ sourceId, rank, title }) => ({ sourceId, rank, title })),
    })),
  };
}

export function formatEvalHour(hour: EvalHour): string[] {
  const lines = [`== ${hour.at.toISOString().slice(0, 16).replace("T", " ")} UTC`];
  if (hour.topics.length === 0) lines.push("   (no combined ranking)");
  for (const topic of hour.topics) {
    lines.push(`  ${String(topic.rank).padStart(2)}. ${topic.label}  (score ${topic.score.toFixed(2)})`);
    for (const m of topic.members) lines.push(`        ${m.sourceId} #${m.rank}: ${m.title}`);
  }
  lines.push("", "  Check: at least 8 of these 10 make sense, and none is a duplicate of another.", "");
  return lines;
}
