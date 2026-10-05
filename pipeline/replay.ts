import { and, asc, eq, gt, gte, inArray, min } from "drizzle-orm";
import { getSource, SOURCES, type SourceId } from "@/collectors/registry";
import type { Region, TrendItem } from "@/collectors/types";
import { DEFAULT_VIEW } from "@/config/ranking";
import { fetchRuns, rankings, sources, topicItems, topicSnapshots, topics, trendItems } from "@/db/schema";
import type { Embedder } from "@/lib/embed";
import { nameKey } from "@/lib/text";
import type { ListResult } from "./collect";
import type { Db } from "./db";
import { rankRun } from "./rank";

// Replay: run the rank step over stored hourly lists, in time order, as if
// each hour were live. It tunes the matching threshold (in a scratch copy)
// and rebuilds topics, rankings and snapshots from the raw lists (a backfill).
// Stored items carry what a live run read, from the run that first stored it:
// Bluesky's status from 2026-10-01 15:07 UTC, so replay drops stale trends from
// then on, and the match text (Google Trends' headlines, Bluesky's
// descriptions) from 2026-10-02, so replay embeds, filters and counts news as
// the live run did. Earlier hours match on titles only and keep every Bluesky
// trend.

const HOUR = 60 * 60 * 1000;
const known = new Set<string>(SOURCES.map((s) => s.id));

export interface Slot {
  at: Date; // the earliest list start in the hour, standing in for the run's start
  results: ListResult[];
  itemIds: Map<TrendItem, number>;
}

// Stored successful lists grouped into hourly slots; when an hour holds more
// than one list for a source and region (a manual run), the latest wins.
export async function loadSlots(db: Db, since?: Date): Promise<Slot[]> {
  const runs = await db
    .select({
      id: fetchRuns.id,
      sourceId: fetchRuns.sourceId,
      region: fetchRuns.region,
      startedAt: fetchRuns.startedAt,
      finishedAt: fetchRuns.finishedAt,
    })
    .from(fetchRuns)
    .where(and(eq(fetchRuns.status, "ok"), gt(fetchRuns.itemCount, 0), since ? gte(fetchRuns.startedAt, since) : undefined))
    .orderBy(asc(fetchRuns.startedAt));

  const byHour = new Map<number, Map<string, (typeof runs)[number]>>();
  for (const run of runs) {
    if (!known.has(run.sourceId)) continue;
    const hour = Math.floor(run.startedAt.getTime() / HOUR);
    const lists = byHour.get(hour) ?? new Map<string, (typeof runs)[number]>();
    lists.set(`${run.sourceId}/${run.region}`, run); // runs are in time order, so the latest wins
    byHour.set(hour, lists);
  }

  const kept = [...byHour.values()].flatMap((lists) => [...lists.values()]);
  const items = new Map<number, (typeof trendItems.$inferSelect)[]>();
  for (let i = 0; i < kept.length; i += 500) {
    const ids = kept.slice(i, i + 500).map((r) => r.id);
    const rows = await db.select().from(trendItems).where(inArray(trendItems.runId, ids)).orderBy(asc(trendItems.rank));
    for (const row of rows) items.set(row.runId, [...(items.get(row.runId) ?? []), row]);
  }

  return [...byHour.keys()]
    .sort((a, b) => a - b)
    .map((hour) => {
      const lists = [...byHour.get(hour)!.values()];
      const itemIds = new Map<TrendItem, number>();
      const results: ListResult[] = lists
        .filter((run) => (items.get(run.id)?.length ?? 0) > 0)
        .map((run) => ({
          source: getSource(run.sourceId as SourceId),
          region: run.region as Region,
          status: "ok",
          startedAt: run.startedAt,
          finishedAt: run.finishedAt ?? run.startedAt,
          items: items.get(run.id)!.map((row) => {
            const item: TrendItem = {
              source: row.sourceId as SourceId,
              region: row.region as Region,
              rank: row.rank,
              title: row.title,
              url: row.url,
              metricValue: row.metricValue ?? undefined,
              metricLabel: row.metricLabel ?? undefined,
              flags: row.status ? { status: row.status } : undefined,
              matchText: row.matchText?.length ? row.matchText : undefined,
            };
            itemIds.set(item, row.id);
            return item;
          }),
        }));
      const at = new Date(Math.min(...lists.map((r) => r.startedAt.getTime())));
      return { at, results, itemIds };
    })
    .filter((slot) => slot.results.length > 0);
}

export async function replaySlots(
  db: Db,
  slots: readonly Slot[],
  options: { threshold: number; embedder: Embedder; blocklist: ReadonlySet<string>; nameMatch?: boolean; onSlot?: (index: number) => void },
): Promise<{ created: number }> {
  let created = 0;
  for (const [index, slot] of slots.entries()) {
    const outcome = await rankRun({
      db,
      results: slot.results,
      itemIds: slot.itemIds,
      now: slot.at,
      embedder: options.embedder,
      blocklist: options.blocklist,
      threshold: options.threshold,
      nameMatch: options.nameMatch,
      replay: true,
    });
    created += outcome.created;
    options.onSlot?.(index);
  }
  return { created };
}

// Embeds each distinct text once; hourly lists repeat many titles.
export function memoEmbedder(embed: Embedder): Embedder {
  const cache = new Map<string, number[]>();
  return async (texts) => {
    const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
    if (missing.length > 0) {
      const vectors = await embed(missing);
      missing.forEach((text, i) => cache.set(text, vectors[i]));
    }
    return texts.map((t) => cache.get(t)!);
  };
}

// Copies sources and stored successful lists (with their ids) into another
// database, such as an in-memory scratch copy for tuning.
export async function copyLists(from: Db, to: Db, since?: Date): Promise<number> {
  const sourceRows = await from.select().from(sources);
  if (sourceRows.length > 0) await to.insert(sources).values(sourceRows).onConflictDoNothing();
  const runRows = await from
    .select()
    .from(fetchRuns)
    .where(and(eq(fetchRuns.status, "ok"), gt(fetchRuns.itemCount, 0), since ? gte(fetchRuns.startedAt, since) : undefined));
  let items = 0;
  for (let i = 0; i < runRows.length; i += 500) {
    const chunk = runRows.slice(i, i + 500);
    await to.insert(fetchRuns).values(chunk);
    const itemRows = await from
      .select()
      .from(trendItems)
      .where(
        inArray(
          trendItems.runId,
          chunk.map((r) => r.id),
        ),
      );
    for (let j = 0; j < itemRows.length; j += 1000) await to.insert(trendItems).values(itemRows.slice(j, j + 1000));
    items += itemRows.length;
  }
  return items;
}

// Deletes everything the rank step derives, so it can be rebuilt from the lists.
export async function resetDerived(db: Db): Promise<void> {
  await db.delete(topicSnapshots);
  await db.delete(rankings);
  await db.delete(topicItems);
  await db.delete(topics);
}

// A rebuild is safe only while the stored lists reach back at least as far as
// the derived data; otherwise resetting would lose history the lists no
// longer cover (items are deleted after 28 days).
export async function rebuildCheck(db: Db): Promise<{ oldestList: Date | null; oldestDerived: Date | null; safe: boolean }> {
  const [list] = await db.select({ at: min(trendItems.fetchedAt) }).from(trendItems);
  const [ranked] = await db.select({ at: min(rankings.computedAt) }).from(rankings);
  const [topic] = await db.select({ at: min(topics.firstSeen) }).from(topics);
  const oldestList = list?.at ?? null;
  const derived = [ranked?.at, topic?.at].filter((d): d is Date => d instanceof Date);
  const oldestDerived = derived.length > 0 ? new Date(Math.min(...derived.map((d) => d.getTime()))) : null;
  const margin = HOUR; // a run's rankings are stamped a moment before its items
  const safe = oldestDerived === null || (oldestList !== null && oldestDerived.getTime() + margin >= oldestList.getTime());
  return { oldestList, oldestDerived, safe };
}

export interface CrossPlatformTopic {
  label: string;
  hoursInTop10: number;
  titles: Record<string, string[]>; // source id → distinct member titles
}

export interface TuneStats {
  threshold: number;
  topics: number;
  top10Entries: number;
  multiPlatformEntries: number; // combined top-10 entries on 2+ platforms' top 10s that hour
  hours: number; // hourly combined top 10s
  duplicateHours: number; // of those, how many held the same name twice
  crossPlatform: CrossPlatformTopic[];
}

export async function tuneStats(db: Db, threshold: number): Promise<TuneStats> {
  const topicRows = await db.select({ id: topics.id, label: topics.label }).from(topics);
  const members = await db
    .select({ topicId: topicItems.topicId, sourceId: trendItems.sourceId, title: trendItems.title })
    .from(topicItems)
    .innerJoin(trendItems, eq(trendItems.id, topicItems.itemId));
  const ranked = await db
    .select({ at: rankings.computedAt, list: rankings.list, view: rankings.region, topicId: rankings.topicId })
    .from(rankings);

  // The tuning numbers are for the default (Global) view.
  const combined = ranked.filter((r) => r.list === "combined" && r.view === DEFAULT_VIEW && r.topicId !== null);
  const platformsAt = new Map<string, Set<string>>();
  for (const row of ranked) {
    if (row.list === "combined" || row.topicId === null) continue;
    const key = `${row.at.getTime()}/${row.topicId}`;
    platformsAt.set(key, (platformsAt.get(key) ?? new Set()).add(row.list));
  }
  const multiPlatformEntries = combined.filter((r) => (platformsAt.get(`${r.at.getTime()}/${r.topicId}`)?.size ?? 0) >= 2).length;
  const hoursInTop10 = new Map<number, number>();
  for (const row of combined) hoursInTop10.set(row.topicId!, (hoursInTop10.get(row.topicId!) ?? 0) + 1);

  const titlesByTopic = new Map<number, Map<string, Set<string>>>();
  for (const m of members) {
    const bySource = titlesByTopic.get(m.topicId) ?? new Map<string, Set<string>>();
    bySource.set(m.sourceId, (bySource.get(m.sourceId) ?? new Set()).add(m.title));
    titlesByTopic.set(m.topicId, bySource);
  }
  const labelOf = new Map(topicRows.map((t) => [t.id, t.label]));
  const crossPlatform = [...titlesByTopic]
    .filter(([, bySource]) => bySource.size >= 2)
    .map(([topicId, bySource]) => ({
      label: labelOf.get(topicId) ?? `topic ${topicId}`,
      hoursInTop10: hoursInTop10.get(topicId) ?? 0,
      titles: Object.fromEntries([...bySource].map(([source, titles]) => [source, [...titles].slice(0, 3)])),
    }))
    .sort((a, b) => b.hoursInTop10 - a.hoursInTop10 || a.label.localeCompare(b.label));

  // Gate 2 asks that no top 10 holds a duplicate; the same name twice is the kind a count can catch.
  const namesAt = new Map<number, string[]>();
  for (const row of combined) namesAt.set(row.at.getTime(), [...(namesAt.get(row.at.getTime()) ?? []), nameKey(labelOf.get(row.topicId!) ?? "")]);
  const duplicateHours = [...namesAt.values()].filter((names) => new Set(names).size < names.length).length;

  return { threshold, topics: topicRows.length, top10Entries: combined.length, multiPlatformEntries, hours: namesAt.size, duplicateHours, crossPlatform };
}

export function formatTuneStats(stats: TuneStats, limit = 25): string[] {
  const share = stats.top10Entries > 0 ? Math.round((100 * stats.multiPlatformEntries) / stats.top10Entries) : 0;
  const lines = [
    `## Threshold ${stats.threshold.toFixed(2)}`,
    `${stats.topics} topics; ${stats.crossPlatform.length} matched across 2+ platforms; ` +
      `${share}% of combined top-10 entries were on 2+ platforms' top 10s that hour; ` +
      `${stats.duplicateHours} of ${stats.hours} hourly top 10s held the same name twice.`,
    "",
  ];
  for (const topic of stats.crossPlatform.slice(0, limit)) {
    lines.push(`- ${topic.label} (${topic.hoursInTop10} h in the combined top 10)`);
    for (const [source, titles] of Object.entries(topic.titles)) lines.push(`    - ${source}: ${titles.map((t) => `"${t}"`).join(", ")}`);
  }
  if (stats.crossPlatform.length > limit) lines.push(`- … and ${stats.crossPlatform.length - limit} more`);
  lines.push("");
  return lines;
}
