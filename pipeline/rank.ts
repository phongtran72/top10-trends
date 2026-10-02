import { getSource, type SourceId } from "@/collectors/registry";
import { confirmOnly, MATCH_THRESHOLD, UNSCORED_SOURCES } from "@/config/ranking";
import type { TrendItem } from "@/collectors/types";
import { embeddingText, type Embedder } from "@/lib/embed";
import { plainWords, prettyLabel } from "@/lib/text";
import { rankWindow, WINDOWED_SOURCES } from "@/lib/window";
import type { ListResult } from "./collect";
import type { Db } from "./db";
import { filterItems, type Dropped } from "./filter";
import { matchItems, type MatchItem, type Topic } from "./match";
import { currentEntries, scoreTopics, windowedItems, writeRankings, type PlatformRow, type ScoreEntry, type TopicScore } from "./score";
import { algoVersion, buildSnapshots, writeSnapshots } from "./snapshots";
import { loadRecentTopics, saveMatches } from "./topics";

// The rank step: filter this run's lists, embed what's left, match items to
// topics, then write each platform's filtered top 10, the combined top 10 and
// a snapshot of every current topic.
// With no database (a dry run) it matches against no earlier topics and
// scores this run's lists only.

export interface RankInput {
  db: Db | null;
  results: readonly ListResult[];
  itemIds: ReadonlyMap<TrendItem, number> | null; // trend_items ids, for a full run
  now: Date;
  embedder: Embedder;
  blocklist: ReadonlySet<string>;
  threshold?: number;
  replay?: boolean; // rebuilding from stored lists: no headlines or flags
}

export interface RankedTopic {
  label: string;
  score: number;
  isNew: boolean;
  platforms: { sourceId: SourceId; rank: number }[];
}

export interface RankOutcome {
  kept: number;
  snapshots: number;
  dropped: Dropped[];
  created: number;
  matched: number;
  combined: RankedTopic[];
}

// A new topic is named after the item that created it: matching handles lead
// items best rank first, so that is its best-ranked lead item (invariant 9).
export function labelFor(item: Pick<MatchItem, "title">): string {
  return prettyLabel(item.title) || item.title;
}

// One line of context: the first Google Trends headline attached to a topic.
export function contextFor(item: Pick<MatchItem, "sourceId" | "matchText">): string | null {
  if (item.sourceId !== "google_trends") return null;
  return item.matchText?.find((headline) => headline.trim())?.trim().slice(0, 300) ?? null;
}

// Distinct Google Trends headlines attached to each topic in this run: a coarse
// news-coverage signal (the feed carries about three per trend).
export function newsCounts(
  items: readonly TrendItem[],
  keyOf: ReadonlyMap<TrendItem, number>,
  assignments: ReadonlyMap<number, Topic>,
): Map<number, number> {
  const headlines = new Map<number, Set<string>>();
  for (const item of items) {
    if (item.source !== "google_trends" || !item.matchText?.length) continue;
    const topic = assignments.get(keyOf.get(item)!);
    if (topic?.id === null || topic?.id === undefined) continue;
    const set = headlines.get(topic.id) ?? new Set<string>();
    for (const headline of item.matchText) if (headline.trim()) set.add(headline.trim().toLowerCase());
    headlines.set(topic.id, set);
  }
  return new Map([...headlines].map(([id, set]) => [id, set.size]));
}

export async function rankRun(input: RankInput): Promise<RankOutcome> {
  const lists = input.results.filter((r) => r.status === "ok" && r.items.length > 0);
  const dropped: Dropped[] = [];
  const keptByList = lists.map((list) => {
    const filtered = filterItems(list.items, input.blocklist);
    dropped.push(...filtered.dropped);
    // A windowed source's own list is ordered by search volume, not by the feed.
    const kept = WINDOWED_SOURCES.has(list.source.id)
      ? rankWindow(filtered.kept.map((item) => ({ item, title: item.title, metricValue: item.metricValue, rank: item.rank, fetchedAt: list.finishedAt }))).map((w) => w.item)
      : filtered.kept;
    return { list, kept };
  });
  // Ranks within each run: the source's own, or the volume order for a windowed source.
  const runRank = new Map<TrendItem, number>();
  for (const { list, kept: listItems } of keptByList) {
    if (WINDOWED_SOURCES.has(list.source.id)) listItems.forEach((item, index) => runRank.set(item, index + 1));
  }

  // Keys are trend_items ids in a full run, positions in a dry run.
  const kept = keptByList.flatMap((k) => k.kept);
  const keyOf = new Map<TrendItem, number>(kept.map((item, index) => [item, input.itemIds?.get(item) ?? index]));
  // Unscored sources (TikTok) keep their own page list but aren't matched to topics.
  const matchable = keptByList.filter(({ list }) => !UNSCORED_SOURCES.has(list.source.id)).flatMap((k) => k.kept);
  // A run written as one word in this run's news (a brand like "Flydubai") stays whole in hashtags.
  const keep = plainWords(matchable.flatMap((item) => [item.title, ...(item.matchText ?? [])]));
  const regionOf = new Map(matchable.map((item) => [keyOf.get(item)!, item.region]));
  const vectors = await input.embedder(matchable.map((item) => embeddingText(item, { keep })));
  const items: MatchItem[] = matchable.map((item, index) => {
    const source = getSource(item.source);
    return {
      key: keyOf.get(item)!,
      sourceId: item.source,
      // A confirm-only list (X's Worldwide) can join a topic but never starts one.
      role: confirmOnly(item.source, item.region) ? "corroborating" : source.role,
      rank: runRank.get(item) ?? item.rank,
      weight: source.weight,
      title: item.title,
      matchText: item.matchText,
      vector: vectors[index],
    };
  });

  const existing = input.db ? await loadRecentTopics(input.db, input.now) : [];
  const match = matchItems(items, existing, {
    threshold: input.threshold,
    now: input.now,
    labelFor,
    contextFor,
  });
  const created = match.topics.filter((t) => t.isNew).length;
  if (input.db) await saveMatches(input.db, match);
  else match.topics.forEach((topic, index) => (topic.id ??= -(index + 1))); // temporary ids for a dry run

  let platformRows: PlatformRow[] = keptByList.flatMap(({ list, kept: listItems }) =>
    listItems.slice(0, 10).map((item, index) => ({
      sourceId: list.source.id,
      rank: index + 1,
      itemId: keyOf.get(item)!,
      topicId: match.assignments.get(keyOf.get(item)!)?.id ?? null,
    })),
  );
  // With a database, a windowed source's page list is its whole window.
  if (input.db) {
    for (const [sourceId, hours] of WINDOWED_SOURCES) {
      if (!lists.some((list) => list.source.id === sourceId)) continue;
      const window = await windowedItems(input.db, sourceId, input.now, hours);
      platformRows = [
        ...platformRows.filter((row) => row.sourceId !== sourceId),
        ...window.filter((row) => row.rank <= 10).map((row) => ({ sourceId, rank: row.rank, itemId: row.itemId, topicId: row.topicId })),
      ];
    }
  }

  let scores: TopicScore[];
  let snapshots = 0;
  if (input.db) {
    const entries = await currentEntries(input.db, input.now);
    scores = scoreTopics(entries);
    await writeRankings(input.db, input.now, scores, platformRows);
    const rows = buildSnapshots(entries, input.now, {
      algoVersion: algoVersion(input.threshold ?? MATCH_THRESHOLD, input.replay),
      newsCount: newsCounts(kept, keyOf, match.assignments),
    });
    await writeSnapshots(input.db, rows);
    snapshots = rows.length;
  } else {
    const entries: ScoreEntry[] = items.flatMap((item) => {
      const topic = match.assignments.get(item.key);
      return topic ? [{ topicId: topic.id!, sourceId: item.sourceId, rank: item.rank, region: regionOf.get(item.key) }] : [];
    });
    scores = scoreTopics(entries);
  }

  const topicById = new Map<number, Topic>(match.topics.map((t) => [t.id!, t]));
  return {
    kept: kept.length,
    snapshots,
    dropped,
    created,
    matched: match.assignments.size,
    combined: scores.slice(0, 10).map((s) => {
      const topic = topicById.get(s.topicId);
      return {
        label: topic?.label ?? `topic ${s.topicId}`,
        score: s.score,
        isNew: topic ? topic.firstSeen.getTime() === input.now.getTime() : false,
        platforms: s.platforms,
      };
    }),
  };
}

export function formatRankOutcome(outcome: RankOutcome): string[] {
  const reasons = new Map<string, number>();
  for (const d of outcome.dropped) reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
  const why = [...reasons].map(([reason, n]) => `${reason} ${n}`).join(", ");
  const lines = [
    `rank: ${outcome.kept} items kept, ${outcome.dropped.length} dropped${why ? ` (${why})` : ""}; ` +
      `${outcome.matched} matched to topics, ${outcome.created} new topics` +
      (outcome.snapshots > 0 ? `, ${outcome.snapshots} topic snapshots` : ""),
    "combined top 10:",
  ];
  outcome.combined.forEach((topic, index) => {
    const where = topic.platforms.map((p) => `${p.sourceId} #${p.rank}`).join(", ");
    lines.push(`  ${String(index + 1).padStart(2)}. ${topic.label} · ${topic.score.toFixed(2)} · ${where}${topic.isNew ? " · new" : ""}`);
  });
  return lines;
}
