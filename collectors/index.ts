import { bluesky } from "./bluesky";
import { googleTrends } from "./google-trends";
import { hackerNews } from "./hacker-news";
import { mastodon } from "./mastodon";
import type { SourceId } from "./registry";
import { twitch } from "./twitch";
import type { Collector } from "./types";
import { youtube } from "./youtube";

// Every built collector, by source id. A source runs only when it is listed
// here, its keys are present and it isn't in DISABLED_SOURCES.
export const COLLECTORS: ReadonlyMap<SourceId, Collector> = new Map(
  [bluesky, googleTrends, youtube, mastodon, hackerNews, twitch].map((collector) => [collector.id, collector]),
);
