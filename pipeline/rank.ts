import { getSource, type SourceId } from "@/collectors/registry";
import type { TrendItem } from "@/collectors/types";
import { embeddingText, type Embedder } from "@/lib/embed";
import { prettyLabel } from "@/lib/text";
import type { ListResult } from "./collect";
import type { Db } from "./db";
import { filterItems, type Dropped } from "./filter";
import { matchItems, type MatchItem, type Topic } from "./match";
import { currentEntries, scoreTopics, writeRankings, type PlatformRow, type ScoreEntry, type TopicScore } from "./score";
import { loadRecentTopics, saveMatches } from "./topics";

// The rank step: filter this run's lists, embed what's left, match items to
// topics, then write each platform's filtered top 10 and the combined top 10.
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
}

export interface RankedTopic {
  label: string;
  score: number;
  isNew: boolean;
  platforms: { sourceId: SourceId; rank: number }[];
}

export interface RankOutcome {
  kept: number;
  dropped: Dropped[];
  created: number;
  matched: number;
  combined: RankedTopic[];
}

export function labelFor(item: Pick<MatchItem, "title">): string {
  return prettyLabel(item.title) || item.title;
}

export async function rankRun(input: RankInput): Promise<RankOutcome> {
  const lists = input.results.filter((r) => r.status === "ok" && r.items.length > 0);
  const dropped: Dropped[] = [];
  const keptByList = lists.map((list) => {
    const filtered = filterItems(list.items, input.blocklist);
    dropped.push(...filtered.dropped);
    return { list, kept: filtered.kept };
  });

  // Keys are trend_items ids in a full run, positions in a dry run.
  const kept = keptByList.flatMap((k) => k.kept);
  const keyOf = new Map<TrendItem, number>(kept.map((item, index) => [item, input.itemIds?.get(item) ?? index]));
  const vectors = await input.embedder(kept.map(embeddingText));
  const items: MatchItem[] = kept.map((item, index) => {
    const source = getSource(item.source);
    return {
      key: keyOf.get(item)!,
      sourceId: item.source,
      role: source.role,
      rank: item.rank,
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
    contextFor: () => null,
  });
  const created = match.topics.filter((t) => t.isNew).length;
  if (input.db) await saveMatches(input.db, match);
  else match.topics.forEach((topic, index) => (topic.id ??= -(index + 1))); // temporary ids for a dry run

  const platformRows: PlatformRow[] = keptByList.flatMap(({ list, kept: listItems }) =>
    listItems.slice(0, 10).map((item, index) => ({
      sourceId: list.source.id,
      rank: index + 1,
      itemId: keyOf.get(item)!,
      topicId: match.assignments.get(keyOf.get(item)!)?.id ?? null,
    })),
  );

  let scores: TopicScore[];
  if (input.db) {
    scores = scoreTopics(await currentEntries(input.db, input.now));
    await writeRankings(input.db, input.now, scores, platformRows);
  } else {
    const entries: ScoreEntry[] = items.flatMap((item) => {
      const topic = match.assignments.get(item.key);
      return topic ? [{ topicId: topic.id!, sourceId: item.sourceId, rank: item.rank }] : [];
    });
    scores = scoreTopics(entries);
  }

  const topicById = new Map<number, Topic>(match.topics.map((t) => [t.id!, t]));
  return {
    kept: kept.length,
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
      `${outcome.matched} matched to topics, ${outcome.created} new topics`,
    "combined top 10:",
  ];
  outcome.combined.forEach((topic, index) => {
    const where = topic.platforms.map((p) => `${p.sourceId} #${p.rank}`).join(", ");
    lines.push(`  ${String(index + 1).padStart(2)}. ${topic.label} · ${topic.score.toFixed(2)} · ${where}${topic.isNew ? " · new" : ""}`);
  });
  return lines;
}
