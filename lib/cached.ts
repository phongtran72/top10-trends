import { unstable_cache } from "next/cache";
import { getSource, type SourceId } from "@/collectors/registry";
import type { Region } from "@/collectors/types";
import { ITEM_RETENTION_DAYS, type View } from "@/config/ranking";
import { archiveDay, archiveDays, archivePlatformLists } from "@/lib/archive-queries";
import { buildDashboard, DASHBOARD_WINDOW_HOURS } from "@/lib/dashboard";
import { failingSources } from "@/lib/alerts";
import { getDb, oneAtATime } from "@/lib/db";
import { platformList, recentTopItems, sourceStatuses, spendThisMonth } from "@/lib/queries";
import { TRENDS_TAG } from "@/lib/revalidate";
import { combinedTop, recentTopTopics, topicDetail } from "@/lib/topic-queries";

// Database reads cached in Next's data cache under the `trends` tag, which
// POST /api/revalidate expires after each pipeline run. The pages render per
// request (they read `?region=`, so `next build` never queries the database)
// and read through these, so visits rarely reach Postgres. A function's
// arguments are part of its cache key.
// unstable_cache is the pre-Cache-Components API; see PLAN.md › Tech stack.

// Every read goes through one queue, so no two overlap on the connection.
const read = <T>(job: (db: ReturnType<typeof getDb>) => Promise<T>): Promise<T> => oneAtATime(() => job(getDb()));

export const getSourceStatuses = unstable_cache(
  async () => read((db) => sourceStatuses(db, new Date())),
  ["source-statuses-v1"],
  { tags: [TRENDS_TAG], revalidate: 3600 },
);

export const getDashboard = unstable_cache(
  async () => {
    const now = new Date();
    const since = new Date(now.getTime() - DASHBOARD_WINDOW_HOURS * 60 * 60 * 1000);
    return buildDashboard(await read((db) => recentTopItems(db, since)), now);
  },
  ["dashboard-v1"],
  { tags: [TRENDS_TAG], revalidate: 3600 },
);

export const getCombinedTop = unstable_cache(async (view: View) => read((db) => combinedTop(db, view)), ["combined-top-v3"], {
  tags: [TRENDS_TAG],
  revalidate: 3600,
});

export const getTopicDetail = unstable_cache(
  async (slug: string, view: View) => read((db) => topicDetail(db, slug, view)),
  ["topic-detail-v2"],
  { tags: [TRENDS_TAG], revalidate: 3600 },
);

export const getPlatformList = unstable_cache(
  async (sourceId: SourceId, feed: Region) => read((db) => platformList(db, getSource(sourceId), feed)),
  ["platform-list-v1"],
  { tags: [TRENDS_TAG], revalidate: 3600 },
);

export const getSpend = unstable_cache(async () => read((db) => spendThisMonth(db, new Date())), ["spend-v1"], {
  tags: [TRENDS_TAG],
  revalidate: 3600,
});

export const getArchiveDays = unstable_cache(async () => read((db) => archiveDays(db)), ["archive-days-v1"], {
  tags: [TRENDS_TAG],
  revalidate: 3600,
});

// A day's combined top 10s for one view, and whether that day's per-platform
// lists are still stored (items are purged after 28 days).
export const getArchiveDay = unstable_cache(
  async (date: string, view: View) => {
    const lists = await read((db) => archiveDay(db, date, view));
    const oldestKept = Date.now() - ITEM_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    return { lists, platformListsKept: lists.some((list) => Date.parse(list.at) > oldestKept) };
  },
  ["archive-day-v1"],
  { tags: [TRENDS_TAG], revalidate: 3600 },
);

export const getArchivePlatformLists = unstable_cache(async (at: string) => read((db) => archivePlatformLists(db, at)), ["archive-platform-lists-v1"], {
  tags: [TRENDS_TAG],
  revalidate: 3600,
});

// Topics for sitemap.xml: those in a combined top 10 in the last 28 days.
export const getSitemapTopics = unstable_cache(
  async () => read((db) => recentTopTopics(db, new Date(Date.now() - ITEM_RETENTION_DAYS * 24 * 60 * 60 * 1000))),
  ["sitemap-topics-v1"],
  { tags: [TRENDS_TAG], revalidate: 3600 },
);

// Sources failing for six hours or more, for the banner (task 4.3). Recomputed
// at least hourly even when the pipeline has stopped refreshing the cache,
// which is exactly when the banner matters.
export const getAlerts = unstable_cache(
  async () => {
    const now = new Date();
    return failingSources(await read((db) => sourceStatuses(db, now)), now);
  },
  ["alerts-v1"],
  { tags: [TRENDS_TAG], revalidate: 3600 },
);
