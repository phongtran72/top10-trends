import { z } from "zod";
import type { Collector, TrendItem } from "./types";
import { absoluteUrl, requireRegion } from "./util";

// app.bsky.unspecced.getTrends is "unspecced": link is a relative path, status
// is free text (seen: trending, cooling, stale) and topic is an opaque id. The
// schema reads only what we map, so actors (real profiles) are never kept.
const TrendsResponse = z.object({
  trends: z.array(
    z.object({
      topic: z.string(),
      displayName: z.string().optional(),
      description: z.string().optional(),
      link: z.string(),
      postCount: z.number().optional(),
      status: z.string().optional(),
    }),
  ),
});

export const bluesky: Collector = {
  id: "bluesky",
  async fetch(region, { http }) {
    requireRegion("bluesky", region, ["global"]);
    const data = TrendsResponse.parse(
      await http.getJson("https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends?limit=25"),
    );
    return data.trends
      .filter((trend) => trend.displayName?.trim())
      .map(
        (trend, index): TrendItem => ({
          source: "bluesky",
          region,
          rank: index + 1,
          title: trend.displayName!.trim(),
          url: absoluteUrl("https://bsky.app", trend.link),
          metricValue: trend.postCount,
          metricLabel: trend.postCount === undefined ? undefined : "posts",
          matchText: trend.description ? [trend.description] : undefined,
          flags: trend.status ? { status: trend.status } : undefined,
        }),
      );
  },
};
