import { z } from "zod";
import { latestApifyItems } from "./apify";
import type { Collector, TrendItem } from "./types";
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
  }),
);

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
        return {
          source: "tiktok",
          region,
          rank: index + 1,
          title: `#${name}`,
          url: `https://www.tiktok.com/tag/${encodeURIComponent(name)}`,
          metricValue: views ?? posts,
          metricLabel: views !== undefined ? "views" : posts !== undefined ? "posts" : undefined,
        };
      });
  },
};
