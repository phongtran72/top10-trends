import { and, asc, desc, eq, gt, inArray, lte, ne } from "drizzle-orm";
import { getSource, pageRegion, platformSlug, SOURCES, type SourceId } from "@/collectors/registry";
import { confirmOnly, DEFAULT_VIEW, FRESH_LIST_HOURS, inView, type View } from "@/config/ranking";
import { rankings, topicItems, topics, trendItems } from "@/db/schema";
import type { Db } from "@/db/types";
import { bestEntries, currentEntries, PLATFORM_ROWS_REGION, viewEntries } from "@/pipeline/score";

// Queries behind the combined top 10 and the topic pages. Plain JSON results
// (dates as ISO strings), so they can be cached.

const HOUR = 60 * 60 * 1000;

export interface PlatformRank {
  sourceId: SourceId;
  name: string;
  slug: string;
  rank: number;
  // Set when the platform no longer lists the topic and it still counts at the
  // rank it was last seen with (Bluesky's grace hours): the time of that sighting.
  seenAt?: string;
  // Set when the rank comes from a feed other than the one the platform's page
  // shows first, such as Google Trends' UK feed: that feed's region.
  feed?: string;
}

export interface CombinedEntry {
  rank: number;
  topicId: number;
  slug: string;
  label: string;
  summary: string | null;
  score: number;
  change: number | null; // places gained since about 24 hours earlier; null when new
  platforms: PlatformRank[];
}

export interface CombinedTop {
  computedAt: string;
  compared: boolean; // whether a ranking from about 24 hours earlier exists
  entries: CombinedEntry[];
}

const known = new Set<string>(SOURCES.map((s) => s.id));

// What a page shows for a topic: Claude's name and reason when it has them
// (task 3.6), else the platform's own wording and the first headline.
function displayText(topic: { label: string; summary: string | null; name: string | null; reason: string | null }) {
  return { label: topic.name ?? topic.label, summary: topic.reason ?? topic.summary };
}

function platformRank(list: string, rank: number, feed?: string): PlatformRank | null {
  if (!known.has(list)) return null;
  const source = getSource(list as SourceId);
  const entry: PlatformRank = { sourceId: source.id, name: source.name, slug: platformSlug(source.id), rank };
  if (feed && feed !== pageRegion(source)) entry.feed = feed;
  return entry;
}

const byRankThenWeight = (a: PlatformRank, b: PlatformRank) =>
  a.rank - b.rank || getSource(b.sourceId).weight - getSource(a.sourceId).weight;

// Where each topic stands in each platform's newest filtered top 10 from the
// three hours before `at`, among the lists in the view (the best rank when a
// platform has several feeds). A platform the combined score counted from outside
// that top 10 is added at the rank the score used: a place past 10, or a
// Bluesky topic in its grace hours (marked with when it was last listed).
// A confirm-only list (X's Worldwide) gives a badge only that second way,
// so X's badge matches X's page and the score.
async function platformRanks(db: Db, topicIds: number[], at: Date, view: View): Promise<Map<number, PlatformRank[]>> {
  const result = new Map<number, PlatformRank[]>();
  if (topicIds.length === 0) return result;
  const since = new Date(at.getTime() - FRESH_LIST_HOURS * HOUR);
  const window = and(
    ne(rankings.list, "combined"),
    eq(rankings.region, PLATFORM_ROWS_REGION),
    gt(rankings.computedAt, since),
    lte(rankings.computedAt, at),
  );
  const newest = await db
    .selectDistinctOn([rankings.list], { list: rankings.list, computedAt: rankings.computedAt })
    .from(rankings)
    .where(window)
    .orderBy(rankings.list, desc(rankings.computedAt));
  const newestAt = new Map(newest.map((n) => [n.list, n.computedAt.getTime()]));
  const rows = await db
    .select({ list: rankings.list, computedAt: rankings.computedAt, rank: rankings.rank, topicId: rankings.topicId, feed: trendItems.region })
    .from(rankings)
    .innerJoin(trendItems, eq(trendItems.id, rankings.itemId))
    .where(and(window, inArray(rankings.topicId, topicIds)));
  for (const row of rows) {
    if (row.topicId === null || newestAt.get(row.list) !== row.computedAt.getTime()) continue;
    if (confirmOnly(row.list, row.feed) || !inView(view, row.list, row.feed)) continue;
    const entry = platformRank(row.list, row.rank, row.feed);
    if (!entry) continue;
    const list = result.get(row.topicId) ?? [];
    const index = list.findIndex((p) => p.sourceId === entry.sourceId);
    // The best rank among the platform's feeds; on a tie, the feed its page shows.
    if (index === -1) list.push(entry);
    else if (entry.rank < list[index].rank || (entry.rank === list[index].rank && !entry.feed)) list[index] = entry;
    result.set(row.topicId, list);
  }

  const onPage = new Map([...result].map(([topicId, list]) => [topicId, new Set(list.map((p) => p.sourceId))]));
  const scored = bestEntries(viewEntries(await currentEntries(db, at), view));
  for (const topicId of topicIds) {
    for (const [sourceId, counted] of scored.get(topicId) ?? []) {
      if (onPage.get(topicId)?.has(sourceId)) continue;
      const entry = platformRank(sourceId, counted.rank, counted.region);
      if (!entry) continue;
      if (counted.via === "grace" && counted.seenAt) entry.seenAt = counted.seenAt.toISOString();
      result.set(topicId, [...(result.get(topicId) ?? []), entry]);
    }
  }
  for (const list of result.values()) list.sort(byRankThenWeight);
  return result;
}

async function latestCombinedAt(db: Db, region: string, notAfter?: Date): Promise<Date | null> {
  const [row] = await db
    .select({ computedAt: rankings.computedAt })
    .from(rankings)
    .where(
      and(
        eq(rankings.list, "combined"),
        eq(rankings.region, region),
        notAfter ? lte(rankings.computedAt, notAfter) : undefined,
      ),
    )
    .orderBy(desc(rankings.computedAt))
    .limit(1);
  return row?.computedAt ?? null;
}

// A view's newest combined top 10, with each topic's platforms and its change
// against the ranking computed about 24 hours earlier.
export async function combinedTop(db: Db, region: View = DEFAULT_VIEW): Promise<CombinedTop | null> {
  const at = await latestCombinedAt(db, region);
  if (!at) return null;
  const rows = await db
    .select({
      rank: rankings.rank,
      topicId: topics.id,
      slug: topics.slug,
      label: topics.label,
      summary: topics.summary,
      name: topics.name,
      reason: topics.reason,
      score: rankings.score,
    })
    .from(rankings)
    .innerJoin(topics, eq(topics.id, rankings.topicId))
    .where(and(eq(rankings.list, "combined"), eq(rankings.region, region), eq(rankings.computedAt, at)))
    .orderBy(asc(rankings.rank));

  // "About 24 hours earlier": the newest ranking at least 23.5 hours older,
  // if it is no more than 26 hours older.
  const before = await latestCombinedAt(db, region, new Date(at.getTime() - 23.5 * HOUR));
  const compared = before !== null && at.getTime() - before.getTime() <= 26 * HOUR;
  const previous = new Map<number, number>();
  if (compared) {
    const prior = await db
      .select({ topicId: rankings.topicId, rank: rankings.rank })
      .from(rankings)
      .where(and(eq(rankings.list, "combined"), eq(rankings.region, region), eq(rankings.computedAt, before!)));
    for (const p of prior) if (p.topicId !== null) previous.set(p.topicId, p.rank);
  }

  const platforms = await platformRanks(db, rows.map((r) => r.topicId), at, region);
  return {
    computedAt: at.toISOString(),
    compared,
    entries: rows.map(({ name, reason, ...row }) => {
      const was = previous.get(row.topicId);
      return {
        ...row,
        ...displayText({ ...row, name, reason }),
        score: row.score ?? 0,
        change: was === undefined ? null : was - row.rank,
        platforms: platforms.get(row.topicId) ?? [],
      };
    }),
  };
}

export interface TopicLink {
  title: string;
  url: string;
  rank: number;
  fetchedAt: string;
}

export interface TopicDetail {
  slug: string;
  label: string;
  summary: string | null;
  firstSeen: string;
  lastSeen: string;
  currentRank: number | null; // in the newest combined top 10
  platforms: PlatformRank[]; // where it stands now
  history: { at: string; rank: number }[]; // combined ranks over the last 7 days
  links: { sourceId: SourceId; name: string; slug: string; items: TopicLink[] }[];
}

export async function topicDetail(db: Db, slug: string, region: View = DEFAULT_VIEW): Promise<TopicDetail | null> {
  const [topic] = await db.select().from(topics).where(eq(topics.slug, slug)).limit(1);
  if (!topic) return null;
  const at = (await latestCombinedAt(db, region)) ?? topic.lastSeen;

  const history = await db
    .select({ at: rankings.computedAt, rank: rankings.rank })
    .from(rankings)
    .where(
      and(
        eq(rankings.list, "combined"),
        eq(rankings.region, region),
        eq(rankings.topicId, topic.id),
        gt(rankings.computedAt, new Date(at.getTime() - 7 * 24 * HOUR)),
      ),
    )
    .orderBy(asc(rankings.computedAt));
  const current = history.find((h) => h.at.getTime() === at.getTime());

  // Links from items still stored (28 days), newest first; the best 5 per platform.
  const items = await db
    .select({
      sourceId: trendItems.sourceId,
      title: trendItems.title,
      url: trendItems.url,
      rank: trendItems.rank,
      fetchedAt: trendItems.fetchedAt,
    })
    .from(topicItems)
    .innerJoin(trendItems, eq(trendItems.id, topicItems.itemId))
    .where(eq(topicItems.topicId, topic.id))
    .orderBy(desc(trendItems.fetchedAt))
    .limit(300);
  const bySource = new Map<SourceId, Map<string, TopicLink>>();
  for (const item of items) {
    if (!known.has(item.sourceId)) continue;
    const links = bySource.get(item.sourceId as SourceId) ?? new Map<string, TopicLink>();
    const seen = links.get(item.url);
    if (!seen) links.set(item.url, { ...item, fetchedAt: item.fetchedAt.toISOString() });
    else seen.rank = Math.min(seen.rank, item.rank);
    bySource.set(item.sourceId as SourceId, links);
  }
  const links = [...bySource]
    .map(([sourceId, map]) => {
      const source = getSource(sourceId);
      return {
        sourceId,
        name: source.name,
        slug: platformSlug(sourceId),
        items: [...map.values()].sort((a, b) => a.rank - b.rank).slice(0, 5),
      };
    })
    .sort((a, b) => getSource(b.sourceId).weight - getSource(a.sourceId).weight || a.name.localeCompare(b.name));

  const platforms = await platformRanks(db, [topic.id], at, region);
  return {
    slug: topic.slug,
    ...displayText(topic),
    firstSeen: topic.firstSeen.toISOString(),
    lastSeen: topic.lastSeen.toISOString(),
    currentRank: current?.rank ?? null,
    platforms: platforms.get(topic.id) ?? [],
    history: history.map((h) => ({ at: h.at.toISOString(), rank: h.rank })),
    links,
  };
}
