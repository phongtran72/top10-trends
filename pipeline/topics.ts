import { count, eq, gt, inArray } from "drizzle-orm";
import { TOPIC_WINDOW_HOURS } from "@/config/ranking";
import { topicItems, topics } from "@/db/schema";
import { slugify } from "@/lib/text";
import type { Db } from "./db";
import type { MatchResult, Topic } from "./match";

// Loading and saving topics for matching.

// Topics seen in the last 48 hours, with how many items shaped each centroid.
export async function loadRecentTopics(db: Db, now: Date, hours = TOPIC_WINDOW_HOURS): Promise<Topic[]> {
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: topics.id,
      label: topics.label,
      summary: topics.summary,
      centroid: topics.centroid,
      firstSeen: topics.firstSeen,
      lastSeen: topics.lastSeen,
    })
    .from(topics)
    .where(gt(topics.lastSeen, since));
  if (rows.length === 0) return [];
  const counts = await db
    .select({ topicId: topicItems.topicId, items: count() })
    .from(topicItems)
    .where(
      inArray(
        topicItems.topicId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(topicItems.topicId);
  const countOf = new Map(counts.map((c) => [c.topicId, Number(c.items)]));
  return rows.map((row) => ({
    ...row,
    count: Math.max(1, countOf.get(row.id) ?? 1),
    isNew: false,
    changed: false,
  }));
}

function slugDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

// Inserts a new topic under a unique slug: "<label>-<yyyymmdd>", then "-2", "-3"…
async function insertTopic(db: Db, topic: Topic): Promise<number> {
  const base = `${slugify(topic.label, 48)}-${slugDate(topic.firstSeen)}`;
  for (let attempt = 1; attempt <= 20; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    const [row] = await db
      .insert(topics)
      .values({
        slug,
        label: topic.label,
        summary: topic.summary,
        centroid: topic.centroid,
        firstSeen: topic.firstSeen,
        lastSeen: topic.lastSeen,
      })
      .onConflictDoNothing({ target: topics.slug })
      .returning({ id: topics.id });
    if (row) return row.id;
  }
  throw new Error(`no free slug for ${base}`);
}

// Saves new and changed topics and links each assigned item to its topic.
export async function saveMatches(db: Db, result: MatchResult): Promise<{ created: number; updated: number; linked: number }> {
  let created = 0;
  let updated = 0;
  for (const topic of result.topics) {
    if (topic.isNew) {
      topic.id = await insertTopic(db, topic);
      topic.isNew = false;
      created += 1;
    } else if (topic.changed && topic.id !== null) {
      await db
        .update(topics)
        .set({ centroid: topic.centroid, lastSeen: topic.lastSeen, summary: topic.summary })
        .where(eq(topics.id, topic.id));
      updated += 1;
    }
  }
  const links = [...result.assignments].map(([itemId, topic]) => ({ topicId: topic.id!, itemId }));
  if (links.length > 0) await db.insert(topicItems).values(links).onConflictDoNothing();
  return { created, updated, linked: links.length };
}
