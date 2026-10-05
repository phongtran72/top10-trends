// Ranking weights, thresholds and caps. Starting values and the reasons for
// them are in PLAN.md › Ranking; record any tuning there too (task 2.9).

// Lead sources: X, Google Trends, Bluesky, Mastodon.
// Corroborating only: YouTube, Reddit, TikTok, Instagram, Twitch, Hacker News, Pinterest.
export const WEIGHTS = {
  x: 1.0,
  google_trends: 1.0,
  reddit: 0.8,
  bluesky: 0.5,
  mastodon: 0.3,
  youtube: 0.8,
  tiktok: 0.5,
  instagram: 0.5,
  twitch: 0.3,
  hacker_news: 0.3,
  pinterest: 0.3,
} as const;

// Topic matching: join the nearest topic centroid from the last 48 hours at
// cosine similarity >= this. 0.86 is where nomic-embed-text-v1.5 (384 numbers)
// made 90–95% right merges on hand-checked pairs; task 2.9 confirms it on a
// week of data with `npm run replay -- tune`.
export const MATCH_THRESHOLD = 0.86;
export const TOPIC_WINDOW_HOURS = 48;

// Only lists fetched within the last 3 hours count toward the combined score.
export const FRESH_LIST_HOURS = 3;
// Sources left out of topic matching and the combined score; their own pages
// still show their lists. TikTok's Creative Center ranking covers a 7-day
// window that runs several days behind (its curves on 2026-10-01 ended on
// 2026-09-27), so it would lend last week's weight to today's topics.
export const UNSCORED_SOURCES: ReadonlySet<string> = new Set(["tiktok"]);

// Lists that only back up other lists, written as `source:region`. X's
// Worldwide list is mostly trends from countries that don't post in English:
// over 30 hours to 2026-10-02 the filters kept 330 of its 600 trends, and 207
// of those (63%) were not on X's US list, nearly all Brazilian, Thai,
// Indonesian, Turkish or Indian names and fan tags that no language filter
// can tell from English names ("Globo", "Lula", "Renan"). So a trend on such a
// list never starts a topic, and it counts in the combined score only when
// the topic also has a lead entry from another list (X's US list, Google
// Trends, Bluesky or Mastodon). When X's US list has the topic too, X's rank
// is the US one: a Thai fan tag at #19 in the US and #3 worldwide counts as
// #19.
export const CONFIRM_ONLY_LISTS: ReadonlySet<string> = new Set(["x:global"]);
export function confirmOnly(sourceId: string, region: string | undefined): boolean {
  return CONFIRM_ONLY_LISTS.has(`${sourceId}:${region}`);
}

// The site's two views (task 3.2). A view is a set of lists, and a list is one
// source's feed for one region. Global is every list. US is the US feeds and
// the worldwide lists: no UK, Canada or Australia feed, and not X's Worldwide
// list. Topics are matched once, over every list, and shared by both views;
// each view has its own combined ranking and snapshots. In the view with
// every list, Google Trends counts as one list across its countries, ranked
// by search volume (lib/window.ts mergeWindows).
export const VIEWS = ["global", "us"] as const;
export type View = (typeof VIEWS)[number];
export const DEFAULT_VIEW: View = "global";
export const EVERY_LIST_VIEW: View = "global";
export function inView(view: View, sourceId: string, region: string | undefined): boolean {
  if (view === EVERY_LIST_VIEW) return true;
  return (region === undefined || region === "us" || region === "global") && !confirmOnly(sourceId, region);
}

// Bluesky re-cuts its trending list every hour, and a topic near the edge
// often drops out for an hour and comes back (research RQ1: 47% of its top-10
// stays are returns). A Bluesky topic missing from its latest list keeps its
// last rank in the combined score for this long after it was last seen.
export const BLUESKY_GRACE_HOURS = 2;
export const TOP_N = 10;

// X is billed per request: at most 60 trend requests per UTC day.
export const X_DAILY_REQUEST_CAP = 60;

// Retention: items (and their topic links and per-platform rankings) 28 days,
// inside YouTube's 30-day limit; fetch_runs 90 days.
export const ITEM_RETENTION_DAYS = 28;
export const FETCH_RUN_RETENTION_DAYS = 90;

// Bump when weights, filters, windows, grace or scoring change, so analyses
// of stored snapshots can tell methods apart (topic_snapshots.algo_version).
// r1: phase 2 as launched on 2026-10-01. r2: Bluesky trends marked cooling
// are kept; only stale ones are dropped. r3: X's Worldwide list only backs
// up other lists (CONFIRM_ONLY_LISTS). r4: X's rank is its US list's when
// the US list has the topic. r5: two views, Global and US; Google Trends and
// YouTube add UK, Canada and Australia feeds, which count in Global only.
// r6: an item joins a topic that has exactly its name, before vectors are
// compared (pipeline/match.ts).
export const RANKING_VERSION = "r6";
