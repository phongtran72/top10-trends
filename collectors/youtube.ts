import { z } from "zod";
import type { Collector, TrendItem } from "./types";
import { FEED_COUNTRY, parseCount, requireKey } from "./util";

// videos.list chart=mostPopular, per country (no global chart). The key goes
// in the X-goog-api-key header, never the URL. `fields` trims the response to
// what we map; YouTube's policy caps stored API data at 30 days.
const Videos = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({ title: z.string() }),
      statistics: z.object({ viewCount: z.string().optional() }).optional(),
    }),
  ),
});

export const youtube: Collector = {
  id: "youtube",
  async fetch(region, { http, env }) {
    const regionCode = FEED_COUNTRY[region];
    if (!regionCode) throw new Error(`youtube has no ${region} chart`);
    const key = requireKey(env, "YOUTUBE_API_KEY");
    const params = new URLSearchParams({
      part: "snippet,statistics",
      chart: "mostPopular",
      regionCode,
      maxResults: "25",
      fields: "items(id,snippet/title,statistics/viewCount)",
    });
    const data = Videos.parse(
      await http.getJson(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
        headers: { "X-goog-api-key": key },
      }),
    );
    return data.items.map((video, index): TrendItem => {
      const views = parseCount(video.statistics?.viewCount);
      return {
        source: "youtube",
        region,
        rank: index + 1,
        title: video.snippet.title,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`,
        metricValue: views,
        metricLabel: views === undefined ? undefined : "views",
      };
    });
  },
};
