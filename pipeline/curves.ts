import { tiktokCurves } from "@/db/schema";
import { describeError } from "@/lib/errors";
import type { ListResult } from "./collect";
import type { Db } from "./db";

// Keeps TikTok's daily popularity curves for research (PLAN.md › Data model).
// trend_items doesn't store them, and they're the only daily history TikTok
// gives. Each curve is named by its hashtag and its last day, so the hourly
// runs that read the same Apify run again insert nothing.

export type CurveRow = typeof tiktokCurves.$inferInsert;

export function curveRows(results: readonly ListResult[]): CurveRow[] {
  const rows: CurveRow[] = [];
  for (const result of results) {
    if (result.source.id !== "tiktok" || result.status !== "ok") continue;
    for (const item of result.items) {
      const series = item.series ?? [];
      if (series.length === 0) continue;
      const windowEnd = series.reduce((last, point) => (point.day > last ? point.day : last), series[0].day);
      const days = new Set<string>();
      for (const point of series) {
        if (days.has(point.day)) continue;
        days.add(point.day);
        rows.push({
          title: item.title.slice(0, 500),
          windowEnd,
          day: point.day,
          value: point.value,
          direction: item.flags?.direction ?? null,
          fetchedAt: result.finishedAt,
        });
      }
    }
  }
  return rows;
}

// Writes the run's new curve rows and returns a log line, or null when there
// were none. Like the rank step it never throws: a failure here is logged and
// never costs the lists, the heartbeat or the page refresh.
export async function keepCurves(db: Db, results: readonly ListResult[]): Promise<string | null> {
  try {
    const rows = curveRows(results);
    if (rows.length === 0) return null;
    const inserted = await db.insert(tiktokCurves).values(rows).onConflictDoNothing().returning({ day: tiktokCurves.day });
    return inserted.length > 0 ? `curves: ${inserted.length} new TikTok curve days` : null;
  } catch (error) {
    return `curves: failed: ${describeError(error)}`;
  }
}
