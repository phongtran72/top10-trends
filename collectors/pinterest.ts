import { z } from "zod";
import { latestApifyItems } from "./apify";
import type { Collector, TrendItem } from "./types";
import { requireRegion } from "./util";

// Pinterest Trends' growing US search keywords (30-day window), scraped twice
// a week by the Apify actor automation-lab/pinterest-trends-scraper (SETUP.md
// §12). Pinterest's own trends API needs a business account and app review;
// its Trends site refreshes weekly, so twice a week is enough.
export const PINTEREST_ACTOR = "automation-lab~pinterest-trends-scraper";
// Runs Monday and Thursday; older results mean the schedule stopped (one
// missed run is fine: a Thursday result is 7 days old by the next Thursday).
export const PINTEREST_MAX_AGE_HOURS = 180;

const Items = z.array(
  z.object({
    term: z.string().default(""),
    country: z.string().optional(),
    trendType: z.string().optional(),
    rank: z.number().optional(),
    // Pinterest's normalized search volume, 0–100.
    searchCount: z.number().nullable().optional(),
  }),
);

export const pinterest: Collector = {
  id: "pinterest",
  async fetch(region, ctx) {
    requireRegion("pinterest", region, ["us"]);
    const items = Items.parse(
      await latestApifyItems(PINTEREST_ACTOR, { label: "Pinterest", maxAgeHours: PINTEREST_MAX_AGE_HOURS }, ctx),
    );
    return items
      .map((item, index) => ({ item, order: item.rank ?? index + 1 }))
      .filter(
        ({ item }) =>
          (item.country ?? "US") === "US" && (item.trendType ?? "growing") === "growing" && item.term.trim(),
      )
      .sort((a, b) => a.order - b.order)
      .map(({ item }, index): TrendItem => {
        const term = item.term.trim().replace(/\s+/g, " ");
        const searchIndex = item.searchCount ?? undefined;
        return {
          source: "pinterest",
          region,
          rank: index + 1,
          title: term,
          url: `https://trends.pinterest.com/detail/?terms=${encodeURIComponent(term)}&country=US`,
          metricValue: searchIndex,
          metricLabel: searchIndex !== undefined ? "search index" : undefined,
        };
      });
  },
};
