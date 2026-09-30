// Prices behind the spend estimate on /status (TASKS.md 3.7). Checked on
// 2026-09-30; update them when a provider changes its prices.

// X pay-per-use: each trends request, from prepaid credits.
export const X_COST_PER_REQUEST = 0.01;

// Apify actors run on schedules set up in Apify (SETUP.md §12), so their cost
// is estimated from the schedule: the cost of one run × runs per day.
export interface ApifySchedule {
  source: "tiktok" | "instagram";
  service: string;
  costPerRun: number;
  runsPerDay: number;
}

export const APIFY_SCHEDULES: readonly ApifySchedule[] = [
  // data_xplorer/tiktok-trends: 15 US hashtags cost $0.048 in a test run.
  { source: "tiktok", service: "TikTok (Apify)", costPerRun: 0.048, runsPerDay: 1 },
  // s-r/instagram-trending-scraper: $0.002 per topic and no start fee; the
  // free plan caps a run at 10 topics.
  { source: "instagram", service: "Instagram (Apify)", costPerRun: 10 * 0.002, runsPerDay: 4 },
];

// Apify's free plan includes this much usage a month, then blocks until the next month.
export const APIFY_FREE_MONTHLY_CREDIT = 5;
