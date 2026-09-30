import type { SourceId } from "@/collectors/registry";
import { FRESH_LIST_HOURS } from "@/config/ranking";

// Google Trends' "Trending now" feed lists the 10 newest US trends, not the
// 10 biggest, and on a busy afternoon it turns over within an hour. So its
// list is every trend it published in the last few hours, ranked by search
// volume (PLAN.md › Ranking › Google Trends window). The collector keeps the
// feed's own order (invariant 3); the pipeline, platform page and dashboard
// rank the window instead.
export const WINDOWED_SOURCES: ReadonlyMap<SourceId, number> = new Map([["google_trends", FRESH_LIST_HOURS]]);

export interface WindowItem {
  title: string;
  metricValue: number | null | undefined;
  rank: number; // position in its own feed
  fetchedAt: Date | string;
}

const time = (value: Date | string) => (typeof value === "string" ? Date.parse(value) : value.getTime());
const key = (title: string) => title.trim().toLowerCase().replace(/\s+/g, " ");

// One entry per title (its latest sighting), biggest search volume first;
// ties go to the newer sighting, then to the better feed position.
export function rankWindow<T extends WindowItem>(items: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const item of items) {
    const seen = latest.get(key(item.title));
    if (!seen || time(item.fetchedAt) > time(seen.fetchedAt) || (time(item.fetchedAt) === time(seen.fetchedAt) && item.rank < seen.rank)) {
      latest.set(key(item.title), item);
    }
  }
  return [...latest.values()].sort(
    (a, b) =>
      (b.metricValue ?? -1) - (a.metricValue ?? -1) || time(b.fetchedAt) - time(a.fetchedAt) || a.rank - b.rank,
  );
}
