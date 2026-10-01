import { z } from "zod";
import type { Collector, TrendItem } from "./types";
import { requireRegion } from "./util";

// r/popular's hot posts, from Reddit's public Atom feed. Reddit refused Data
// API access on 2026-10-01, so this needs no key and gets no scores or NSFW
// flags: only each post's title and id, in the feed's order. r/popular itself
// leaves NSFW posts out for logged-out readers.
const FEED = "https://www.reddit.com/r/popular/hot.rss?limit=25";

const Feed = z.object({
  feed: z.object({
    entry: z
      .array(
        z.object({
          id: z.string().optional(), // "t3_" plus the post id
          title: z.string().optional(),
        }),
      )
      .optional(),
  }),
});

export const reddit: Collector = {
  id: "reddit",
  async fetch(region, { http }) {
    requireRegion("reddit", region, ["global"]);
    const feed = Feed.parse(await http.getXml(FEED));
    return (feed.feed.entry ?? []).flatMap((entry) => {
      const title = entry.title?.trim();
      const postId = /^t3_([a-z0-9]+)$/.exec(entry.id?.trim() ?? "")?.[1];
      return title && postId ? [{ title, postId }] : [];
    }).map(({ title, postId }, index): TrendItem => ({
      source: "reddit",
      region,
      rank: index + 1,
      title,
      url: `https://www.reddit.com/comments/${postId}/`,
    }));
  },
};
