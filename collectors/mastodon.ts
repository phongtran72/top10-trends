import { z } from "zod";
import type { Collector, TrendItem } from "./types";
import { parseCount, requireRegion } from "./util";

// GET /api/v1/trends/tags on one server (trends are per server). history is
// newest first and its values are strings; today's uses cover a partial day.
const Tags = z.array(
  z.object({
    name: z.string(),
    url: z.string(),
    history: z.array(z.object({ uses: z.union([z.string(), z.number()]) })).optional(),
  }),
);

export const mastodon: Collector = {
  id: "mastodon",
  async fetch(region, { http, env }) {
    requireRegion("mastodon", region, ["global"]);
    const instance = env.MASTODON_INSTANCE || "mastodon.social";
    const tags = Tags.parse(await http.getJson(`https://${instance}/api/v1/trends/tags?limit=20`));
    return tags.map((tag, index): TrendItem => {
      const uses = parseCount(tag.history?.[0]?.uses);
      return {
        source: "mastodon",
        region,
        rank: index + 1,
        title: `#${tag.name}`,
        url: tag.url,
        metricValue: uses,
        metricLabel: uses === undefined ? undefined : "uses today",
      };
    });
  },
};
