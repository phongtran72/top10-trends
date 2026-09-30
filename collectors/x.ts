import { z } from "zod";
import type { Collector, TrendItem } from "./types";
import { requireKey } from "./util";

// GET /2/trends/by/woeid/{woeid} with the app's Bearer token. Billed at $0.010
// per request from prepaid credits; the pipeline enforces the daily cap
// (CLAUDE.md invariant 11) before this runs.
const Trends = z.object({
  data: z.array(z.object({ trend_name: z.string(), tweet_count: z.number().optional() })).optional(),
  errors: z.array(z.object({ title: z.string().optional(), detail: z.string().optional() })).optional(),
});

// Where On Earth IDs: Worldwide and the United States.
export const X_WOEID = { global: 1, us: 23424977 } as const;

export const x: Collector = {
  id: "x",
  async fetch(region, { http, env }) {
    if (region !== "global" && region !== "us") throw new Error(`x has no ${region} list`);
    const token = requireKey(env, "X_BEARER_TOKEN");
    const params = new URLSearchParams({ max_trends: "20", "trend.fields": "trend_name,tweet_count" });
    const body = Trends.parse(
      await http.getJson(`https://api.x.com/2/trends/by/woeid/${X_WOEID[region]}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    if (!body.data) {
      const problem = body.errors?.[0];
      throw new Error(`no trends: ${problem?.title ?? problem?.detail ?? "empty response"}`);
    }
    return body.data
      .filter((trend) => trend.trend_name.trim())
      .map(
        (trend, index): TrendItem => ({
          source: "x",
          region,
          rank: index + 1,
          title: trend.trend_name.trim(),
          url: `https://x.com/search?q=${encodeURIComponent(trend.trend_name.trim())}&src=trend_click`,
          metricValue: trend.tweet_count,
          metricLabel: trend.tweet_count === undefined ? undefined : "posts",
        }),
      );
  },
};
