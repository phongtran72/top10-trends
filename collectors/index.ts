import { bluesky } from "./bluesky";
import { googleTrends } from "./google-trends";
import { hackerNews } from "./hacker-news";
import { instagram } from "./instagram";
import { mastodon } from "./mastodon";
import { pinterest } from "./pinterest";
import { reddit } from "./reddit";
import type { SourceId } from "./registry";
import { tiktok } from "./tiktok";
import { twitch } from "./twitch";
import type { Collector } from "./types";
import { x } from "./x";
import { youtube } from "./youtube";

// Every built collector, by source id. A source runs only when it is listed
// here, its keys are present and it isn't in DISABLED_SOURCES.
export const COLLECTORS: ReadonlyMap<SourceId, Collector> = new Map(
  [bluesky, googleTrends, youtube, mastodon, hackerNews, twitch, x, tiktok, instagram, pinterest, reddit].map((collector) => [collector.id, collector]),
);
