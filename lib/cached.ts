import { unstable_cache } from "next/cache";
import { getSource, type SourceId } from "@/collectors/registry";
import type { Region } from "@/collectors/types";
import type { View } from "@/config/ranking";
import { buildDashboard, DASHBOARD_WINDOW_HOURS } from "@/lib/dashboard";
import { getDb } from "@/lib/db";
import { platformList, recentTopItems, sourceStatuses, spendThisMonth } from "@/lib/queries";
import { TRENDS_TAG } from "@/lib/revalidate";
import { combinedTop, topicDetail } from "@/lib/topic-queries";

// Database reads cached in Next's data cache under the `trends` tag, which
// POST /api/revalidate expires after each pipeline run. The pages render per
// request (they read `?region=`, so `next build` never queries the database)
// and read through these, so visits rarely reach Postgres. A function's
// arguments are part of its cache key.
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

export const getCombinedTop = unstable_cache(async (view: View) => combinedTop(getDb(), view), ["combined-top-v2"], {
  tags: [TRENDS_TAG],
  revalidate: 3600,
});

export const getTopicDetail = unstable_cache(
  async (slug: string, view: View) => topicDetail(getDb(), slug, view),
  ["topic-detail-v1"],
  { tags: [TRENDS_TAG], revalidate: 3600 },
);

export const getPlatformList = unstable_cache(
  async (sourceId: SourceId, feed: Region) => platformList(getDb(), getSource(sourceId), feed),
  ["platform-list-v1"],
  { tags: [TRENDS_TAG], revalidate: 3600 },
);

export const getSpend = unstable_cache(async () => spendThisMonth(getDb(), new Date()), ["spend-v1"], {
  tags: [TRENDS_TAG],
  revalidate: 3600,
});
