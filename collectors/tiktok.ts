import { z } from "zod";
import { latestApifyItems } from "./apify";
import type { Collector, SeriesPoint, TrendDirection, TrendItem } from "./types";
import { requireRegion } from "./util";

// TikTok Creative Center's trending US hashtags over a 7-day window, scraped
// once a day by the Apify actor data_xplorer/tiktok-trends (SETUP.md §12).
// Since July 2026 Creative Center shows logged-out visitors only its top 3;
// this actor still returns the full list, which automation-lab's did not.
export const TIKTOK_ACTOR = "data_xplorer~tiktok-trends";
// A daily schedule; older results mean it stopped (one missed run is fine).
export const TIKTOK_MAX_AGE_HOURS = 48;

const Items = z.array(
  z.object({
    Rank: z.number(),
    Hashtag: z.string(),
    "Country Code": z.string().optional(),
    Posts: z.number().nullable().optional(),
    "Video Views": z.number().nullable().optional(),
    "Trend Direction": z.string().nullable().optional(),
    // Checked point by point below, so an odd curve never fails the list.
    "Trend Data": z.array(z.unknown()).nullable().optional(),
  }),
);

// One day of Creative Center's popularity curve: a 0–100 value, dated by
// `date` (YYYY-MM-DD) or, failing that, `timestamp` (Unix seconds).
const CurvePoint = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timestamp: z.number().optional(),
  value: z.number(),
});

const DIRECTIONS: ReadonlySet<string> = new Set<TrendDirection>(["up", "down", "stable"]);

function toSeries(points: readonly unknown[] | null | undefined): SeriesPoint[] | undefined {
  const series = (points ?? []).flatMap((point): SeriesPoint[] => {
    const parsed = CurvePoint.safeParse(point);
    if (!parsed.success || !Number.isFinite(parsed.data.value)) return [];
    const { date, timestamp, value } = parsed.data;
    const day = date ?? (timestamp !== undefined ? new Date(timestamp * 1000).toISOString().slice(0, 10) : undefined);
    return day ? [{ day, value }] : [];
  });
  return series.length > 0 ? series.sort((a, b) => a.day.localeCompare(b.day)) : undefined;
}

export const tiktok: Collector = {
  id: "tiktok",
  async fetch(region, ctx) {
    requireRegion("tiktok", region, ["us"]);
    const items = Items.parse(await latestApifyItems(TIKTOK_ACTOR, { label: "TikTok", maxAgeHours: TIKTOK_MAX_AGE_HOURS }, ctx));
    return items
      .filter((item) => (item["Country Code"] ?? "US") === "US" && item.Hashtag.replace(/^#/, "").trim())
      .sort((a, b) => a.Rank - b.Rank)
      .map((item, index): TrendItem => {
        const name = item.Hashtag.trim().replace(/^#/, "");
        // Creative Center sometimes reports 0 views; fall back to the post count then.
        const views = item["Video Views"] || undefined;
        const posts = item.Posts ?? undefined;
        const direction = item["Trend Direction"]?.toLowerCase();
        return {
          source: "tiktok",
          region,
          rank: index + 1,
          title: `#${name}`,
          url: `https://www.tiktok.com/tag/${encodeURIComponent(name)}`,
          metricValue: views ?? posts,
          metricLabel: views !== undefined ? "views" : posts !== undefined ? "posts" : undefined,
          flags: direction && DIRECTIONS.has(direction) ? { direction: direction as TrendDirection } : undefined,
          series: toSeries(item["Trend Data"]),
        };
      });
  },
};
