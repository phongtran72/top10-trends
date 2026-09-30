import { z } from "zod";
import type { Collector, TrendItem } from "./types";
import { requireRegion } from "./util";

// topstories.json, then the first 25 items fetched five at a time. Deleted,
// dead or untitled items are skipped; ranks follow the remaining order.
const TopStories = z.array(z.number().int());
const Item = z
  .object({
    id: z.number().int(),
    title: z.string().optional(),
    url: z.string().optional(),
    score: z.number().optional(),
    dead: z.boolean().optional(),
    deleted: z.boolean().optional(),
  })
  .nullable();

const API = "https://hacker-news.firebaseio.com/v0";
const TAKE = 25;
const BATCH = 5;

export const hackerNews: Collector = {
  id: "hacker_news",
  async fetch(region, { http }) {
    requireRegion("hacker_news", region, ["global"]);
    const ids = TopStories.parse(await http.getJson(`${API}/topstories.json`)).slice(0, TAKE);
    const items: z.infer<typeof Item>[] = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      items.push(...(await Promise.all(batch.map(async (id) => Item.parse(await http.getJson(`${API}/item/${id}.json`))))));
    }
    return items
      .filter((item): item is NonNullable<typeof item> => Boolean(item && item.title && !item.dead && !item.deleted))
      .map(
        (item, index): TrendItem => ({
          source: "hacker_news",
          region,
          rank: index + 1,
          title: item.title!,
          url: item.url && /^https?:\/\//.test(item.url) ? item.url : `https://news.ycombinator.com/item?id=${item.id}`,
          metricValue: item.score,
          metricLabel: item.score === undefined ? undefined : "points",
        }),
      );
  },
};
