import { unstable_cache } from "next/cache";
import { buildDashboard, DASHBOARD_WINDOW_HOURS } from "@/lib/dashboard";
import { getDb } from "@/lib/db";
import { recentTopItems, sourceStatuses } from "@/lib/queries";
import { TRENDS_TAG } from "@/lib/revalidate";
import { combinedTop } from "@/lib/topic-queries";

// Database reads cached in Next's data cache under the `trends` tag, which
// POST /api/revalidate expires after each pipeline run. Pages that are not
// ISR (they render per request after `connection()`, so `next build` never
// queries the database) read through these, so visits rarely reach Postgres.
// unstable_cache is the pre-Cache-Components API; see PLAN.md › Tech stack.

export const getSourceStatuses = unstable_cache(
  async () => sourceStatuses(getDb(), new Date()),
  ["source-statuses-v1"],
  { tags: [TRENDS_TAG], revalidate: 3600 },
);

export const getDashboard = unstable_cache(
  async () => {
    const now = new Date();
    const since = new Date(now.getTime() - DASHBOARD_WINDOW_HOURS * 60 * 60 * 1000);
    return buildDashboard(await recentTopItems(getDb(), since), now);
  },
  ["dashboard-v1"],
  { tags: [TRENDS_TAG], revalidate: 3600 },
);

export const getCombinedTop = unstable_cache(async () => combinedTop(getDb()), ["combined-top-v1"], {
  tags: [TRENDS_TAG],
  revalidate: 3600,
});
