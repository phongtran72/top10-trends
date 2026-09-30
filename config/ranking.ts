// Ranking weights, thresholds and caps. Starting values and the reasons for
// them are in PLAN.md › Ranking; record any tuning there too (task 2.9).

// Lead sources: X, Google Trends, Reddit, Bluesky, Mastodon.
// Corroborating only: YouTube, TikTok, Instagram, Twitch, Hacker News, Pinterest.
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
// cosine similarity >= 0.80 (tune 0.75–0.85).
export const MATCH_THRESHOLD = 0.8;
export const TOPIC_WINDOW_HOURS = 48;

// Only lists fetched within the last 3 hours count toward the combined score.
export const FRESH_LIST_HOURS = 3;
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

// Bump when weights, filters or scoring change, so analyses of stored
// snapshots can tell methods apart (topic_snapshots.algo_version).
export const RANKING_VERSION = "r1";
