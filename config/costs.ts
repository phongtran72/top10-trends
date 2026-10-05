// Prices behind the spend estimate on /status (TASKS.md 3.7). Checked on
// 2026-09-30; update them when a provider changes its prices.

// X pay-per-use: each trends request, from prepaid credits.
export const X_COST_PER_REQUEST = 0.01;

// Claude Haiku 4.5 naming one topic (task 3.6): about 650 input tokens at $1
// per million and 70 output tokens at $5 per million.
export const CLAUDE_COST_PER_NAME = 0.001;

// Apify actors run on schedules set up in Apify (SETUP.md §12), so their cost
// is estimated from the schedule: the cost of one run × runs per day.
export interface ApifySchedule {
  source: "tiktok" | "instagram" | "pinterest";
  service: string;
  costPerRun: number;
  runsPerDay: number;
}

export const APIFY_SCHEDULES: readonly ApifySchedule[] = [
  // data_xplorer/tiktok-trends: 30 US hashtags are $0.055 in events ($0.025 a
  // run plus $0.001 a hashtag) and about $0.07 on the bill with platform usage.
  { source: "tiktok", service: "TikTok (Apify)", costPerRun: 0.07, runsPerDay: 1 },
  // s-r/instagram-trending-scraper: $0.002 per topic and no start fee; the
  // free plan caps a run at 10 topics. Three runs a day, after Instagram's
  // refreshes at about 01:00, 13:00 and 19:00 UTC.
  { source: "instagram", service: "Instagram (Apify)", costPerRun: 10 * 0.002, runsPerDay: 3 },
  // automation-lab/pinterest-trends-scraper: 25 growing US keywords cost $0.03
  // in a test run; it runs twice a week.
  { source: "pinterest", service: "Pinterest (Apify)", costPerRun: 0.03, runsPerDay: 2 / 7 },
];

// Apify's free plan includes this much usage per billing period (from the
// 30th, not the calendar month), then blocks until the next one.
export const APIFY_FREE_MONTHLY_CREDIT = 5;
