import { and, asc, desc, eq, gt } from "drizzle-orm";
import { getSource, type SourceId } from "@/collectors/registry";
import { rankings, topics } from "@/db/schema";
import type { Db } from "./db";
import { currentEntries } from "./score";

// Evaluation (TASKS.md 2.8): print the combined top 10 of a few past hours
// with each topic's member items and score, for a person to judge whether at
// least 8 of 10 topics make sense and none is a duplicate.

export interface EvalTopic {
  rank: number;
  label: string;
  score: number;
  members: { sourceId: string; rank: number; title: string; region?: string; via?: "window" | "grace" }[];
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
// exactly the entries the score counted (pipeline/score.ts currentEntries),
// so Google's 3-hour window and Bluesky's grace show up too.
export async function evalHour(db: Db, at: Date, region = "global"): Promise<EvalHour> {
  const top = await db
    .select({ rank: rankings.rank, topicId: rankings.topicId, score: rankings.score, label: topics.label })
    .from(rankings)
    .innerJoin(topics, eq(topics.id, rankings.topicId))
    .where(and(eq(rankings.list, "combined"), eq(rankings.region, region), eq(rankings.computedAt, at)))
    .orderBy(asc(rankings.rank));

  const topicIds = new Set(top.map((t) => t.topicId));
  const members = (topicIds.size === 0 ? [] : await currentEntries(db, at))
    .filter((entry) => topicIds.has(entry.topicId))
    .sort((a, b) => a.rank - b.rank || a.sourceId.localeCompare(b.sourceId));

  return {
    at,
    topics: top.map((t) => ({
      rank: t.rank,
      label: t.label,
      score: t.score ?? 0,
      members: members
        .filter((m) => m.topicId === t.topicId)
        .map(({ sourceId, rank, title, region: from, via }) => ({ sourceId, rank, title: title ?? "", region: from, via })),
    })),
  };
}

// "x (us) #1: Harper": the region is shown for a source with more than one list.
function memberLine(m: EvalTopic["members"][number]): string {
  const regions = getSource(m.sourceId as SourceId).regions.length;
  const where = regions > 1 && m.region ? ` (${m.region})` : "";
  const how = m.via === "window" ? "  [left the feed; still in its 3-hour window]" : m.via === "grace" ? "  [missing this hour; in its 2-hour grace]" : "";
  return `        ${m.sourceId}${where} #${m.rank}: ${m.title}${how}`;
}

export function formatEvalHour(hour: EvalHour): string[] {
  const lines = [`== ${hour.at.toISOString().slice(0, 16).replace("T", " ")} UTC`];
  if (hour.topics.length === 0) lines.push("   (no combined ranking)");
  for (const topic of hour.topics) {
    lines.push(`  ${String(topic.rank).padStart(2)}. ${topic.label}  (score ${topic.score.toFixed(2)})`);
    for (const m of topic.members) lines.push(memberLine(m));
  }
  lines.push("", "  Check: at least 8 of these 10 make sense, and none is a duplicate of another.", "");
  return lines;
}
