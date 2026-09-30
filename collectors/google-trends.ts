import { z } from "zod";
import type { Collector, TrendItem } from "./types";
import { FEED_COUNTRY, parseCount } from "./util";

// "Trending now" RSS, one feed per country (no worldwide feed). Each item's
// <link> is only the feed URL, so items link to their first news story, or to
// a Google search for the query.
const Feed = z.object({
  rss: z.object({
    channel: z.object({
      item: z
        .array(
          z.object({
            title: z.string().optional(),
            "ht:approx_traffic": z.string().optional(),
            "ht:news_item": z
              .array(
                z.object({
                  "ht:news_item_title": z.string().optional(),
                  "ht:news_item_url": z.string().optional(),
                }),
              )
              .optional(),
          }),
        )
        .optional(),
    }),
  }),
});

export const googleTrends: Collector = {
  id: "google_trends",
  async fetch(region, { http }) {
    const geo = FEED_COUNTRY[region];
    if (!geo) throw new Error(`google_trends has no ${region} feed`);
    const feed = Feed.parse(await http.getXml(`https://trends.google.com/trending/rss?geo=${geo}`));
    return (feed.rss.channel.item ?? [])
      .filter((item) => item.title?.trim())
      .map((item, index): TrendItem => {
        const title = item.title!.trim();
        const news = item["ht:news_item"] ?? [];
        const headlines = news.map((n) => n["ht:news_item_title"]?.trim()).filter((t): t is string => Boolean(t));
        const storyUrl = news.map((n) => n["ht:news_item_url"]).find((u) => u && /^https?:\/\//.test(u));
        const traffic = parseCount(item["ht:approx_traffic"]);
        return {
          source: "google_trends",
          region,
          rank: index + 1,
          title,
          url: storyUrl ?? `https://www.google.com/search?q=${encodeURIComponent(title)}`,
          metricValue: traffic,
          metricLabel: traffic === undefined ? undefined : "searches",
          matchText: headlines.length > 0 ? headlines : undefined,
        };
      });
  },
};
