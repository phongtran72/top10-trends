import { z } from "zod";
import { latestApifyItems } from "./apify";
import type { Collector, TrendItem } from "./types";
import { requireRegion } from "./util";

// Instagram's public trending topics (instagram.com/popular/...), scraped
// every 6 hours by the Apify actor s-r/instagram-trending-scraper (SETUP.md
// §12). Instagram has no trends API; the list is one worldwide surface, not
// per country, and Apify's free plan caps a run at 10 topics.
export const INSTAGRAM_ACTOR = "s-r~instagram-trending-scraper";
// Runs every 6 hours; older results mean the schedule stopped (two missed runs are fine).
export const INSTAGRAM_MAX_AGE_HOURS = 18;

const Items = z.array(
  z.object({
    // The actor reports failures as rows of another record_type, without a topic.
    record_type: z.string().optional(),
    topic: z.string().default(""),
    keyword_slug: z.string().optional(),
    rank: z.number().optional(),
    // All-time posts under the topic, not a trending count.
    media_count: z.number().nullable().optional(),
  }),
);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const instagram: Collector = {
  id: "instagram",
  async fetch(region, ctx) {
    requireRegion("instagram", region, ["global"]);
    const items = Items.parse(
      await latestApifyItems(INSTAGRAM_ACTOR, { label: "Instagram", maxAgeHours: INSTAGRAM_MAX_AGE_HOURS }, ctx),
    );
    return items
      .map((item, index) => ({ item, order: item.rank ?? index + 1 }))
      .filter(({ item }) => (item.record_type ?? "trending_topic") === "trending_topic" && item.topic.trim())
      .sort((a, b) => a.order - b.order)
      .map(({ item }, index): TrendItem => {
        const topic = item.topic.trim().replace(/\s+/g, " ");
        const slug = item.keyword_slug && SLUG.test(item.keyword_slug) ? item.keyword_slug : null;
        const posts = item.media_count ?? undefined;
        return {
          source: "instagram",
          region,
          rank: index + 1,
          title: topic,
          url: slug
            ? `https://www.instagram.com/popular/${slug}/`
            : `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(topic)}`,
          metricValue: posts,
          metricLabel: posts !== undefined ? "posts" : undefined,
        };
      });
  },
};
