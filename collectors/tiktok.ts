import { z } from "zod";
import type { Collector, TrendItem } from "./types";
import { requireKey, requireRegion } from "./util";

// TikTok has no trends API for individuals, so an Apify actor scrapes the
// Creative Center's trending hashtags (US, 7-day window) on a schedule set up
// in Apify (SETUP.md §12). This collector only reads the latest successful
// run's results: free, fast, and within the 30-second budget, since a run
// itself takes 30 to 90 seconds.
const API = "https://api.apify.com/v2";
export const TIKTOK_ACTOR = "automation-lab~tiktok-trends-scraper";
// The schedule runs every 2 days; older results mean it stopped.
export const TIKTOK_MAX_AGE_HOURS = 72;

const LastRun = z.object({
  data: z.object({
    id: z.string(),
    finishedAt: z.string().nullable(),
    defaultDatasetId: z.string(),
  }),
});

const Items = z.array(
  z.object({
    type: z.string().optional(),
    rank: z.number(),
    name: z.string(),
    countryCode: z.string().optional(),
    videoViews: z.number().nullable().optional(),
    publishedVideoCount: z.number().nullable().optional(),
  }),
);

export const tiktok: Collector = {
  id: "tiktok",
  async fetch(region, { http, env, now }) {
    requireRegion("tiktok", region, ["us"]);
    const token = requireKey(env, "APIFY_TOKEN");
    const headers = { Authorization: `Bearer ${token}` };

    const run = LastRun.parse(await http.getJson(`${API}/acts/${TIKTOK_ACTOR}/runs/last?status=SUCCEEDED`, { headers }));
    const finished = run.data.finishedAt ? new Date(run.data.finishedAt) : null;
    const ageHours = finished ? (now.getTime() - finished.getTime()) / 3_600_000 : Infinity;
    if (ageHours > TIKTOK_MAX_AGE_HOURS) {
      throw new Error(`latest TikTok run finished ${Math.round(ageHours)} h ago; check the Apify schedule`);
    }

    const items = Items.parse(await http.getJson(`${API}/datasets/${run.data.defaultDatasetId}/items?clean=true`, { headers }));
    return items
      .filter((item) => (item.type ?? "hashtag") === "hashtag" && (item.countryCode ?? "US") === "US" && item.name.trim())
      .sort((a, b) => a.rank - b.rank)
      .map((item, index): TrendItem => {
        const name = item.name.trim().replace(/^#/, "");
        const views = item.videoViews ?? undefined;
        const videos = item.publishedVideoCount ?? undefined;
        return {
          source: "tiktok",
          region,
          rank: index + 1,
          title: `#${name}`,
          url: `https://www.tiktok.com/tag/${encodeURIComponent(name)}`,
          metricValue: views ?? videos,
          metricLabel: views !== undefined ? "views" : videos !== undefined ? "videos" : undefined,
        };
      });
  },
};
