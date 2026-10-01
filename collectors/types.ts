import type { Http } from "@/lib/http";
import type { SourceId } from "./registry";

// The feed's real region. `gb`, `ca` and `au` arrive in phase 3.
export type Region = "global" | "us" | "gb" | "ca" | "au";

export interface TrendItem {
  source: SourceId; // registry id
  region: Region; // the feed's real region
  rank: number; // 1-based, in the source's own order
  title: string; // display text as the source gives it
  url: string; // absolute link to the trend, search or post
  metricValue?: number; // post count, views, approximate searches…
  metricLabel?: string; // 'posts', 'views', 'searches'…
  matchText?: string[]; // extra text for topic matching only (e.g. news headlines); not stored
  flags?: { nsfw?: boolean; status?: string; direction?: TrendDirection }; // read by filters and research; only status is stored in trend_items
  // A daily popularity curve the source reports for this item (TikTok: 7 days,
  // values 0–100). Not stored in trend_items; phase 5 keeps it for research.
  series?: SeriesPoint[];
}

export type TrendDirection = "up" | "down" | "stable";

export interface SeriesPoint {
  day: string; // YYYY-MM-DD, UTC
  value: number;
}

// Environment variables with blank values removed; MASTODON_INSTANCE has its default.
export type Env = Readonly<Record<string, string | undefined>>;

export interface CollectorContext {
  http: Http;
  env: Env;
  now: Date;
}

// Collectors only fetch and map (CLAUDE.md invariant 3): they return items in
// the source's own order and leave filtering, matching and scoring to pipeline/.
export interface Collector {
  id: SourceId;
  fetch(region: Region, ctx: CollectorContext): Promise<TrendItem[]>;
}
