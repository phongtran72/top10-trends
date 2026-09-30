// Prices behind the spend estimate on /status (TASKS.md 3.7). Checked on
// 2026-09-30; update them when a provider changes its prices.

// X pay-per-use: each trends request, from prepaid credits.
export const X_COST_PER_REQUEST = 0.01;

// TikTok through the Apify actor automation-lab/tiktok-trends-scraper, on
// Apify's free plan: $0.05 per run plus $0.015 per hashtag, one run every
// TIKTOK_RUN_EVERY_DAYS days (the schedule set up in Apify, SETUP.md §12).
export const TIKTOK_HASHTAGS_PER_RUN = 15;
export const TIKTOK_COST_PER_RUN = 0.05 + TIKTOK_HASHTAGS_PER_RUN * 0.015;
export const TIKTOK_RUN_EVERY_DAYS = 2;
// Apify's free plan includes this much usage a month, then blocks until the next month.
export const APIFY_FREE_MONTHLY_CREDIT = 5;
