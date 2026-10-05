import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { PLATFORMS, platformSlug } from "@/collectors/registry";
import { getArchiveDays, getSitemapTopics } from "@/lib/cached";
import { siteUrl } from "@/lib/site-url";

// sitemap.xml (task 4.2): the home page, each platform, the archive's days and
// the topics that were in a combined top 10 in the last 28 days. It renders
// per request (never at build time) from cached data.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const base = siteUrl();
  const days = await getArchiveDays();
  const topics = await getSitemapTopics();
  return [
    { url: `${base}/`, changeFrequency: "hourly", priority: 1 },
    ...PLATFORMS.map((source) => ({ url: `${base}/p/${platformSlug(source.id)}`, changeFrequency: "hourly" as const, priority: 0.8 })),
    { url: `${base}/archive`, changeFrequency: "daily", priority: 0.5 },
    ...days.map((day, index) => ({
      url: `${base}/archive/${day.date}`,
      // Today's page still changes every hour; a past day never does.
      changeFrequency: index === 0 ? ("hourly" as const) : ("never" as const),
      priority: 0.4,
    })),
    ...topics.map((topic) => ({ url: `${base}/t/${topic.slug}`, lastModified: topic.lastRankedAt, changeFrequency: "daily" as const, priority: 0.6 })),
    { url: `${base}/status`, changeFrequency: "hourly", priority: 0.2 },
  ];
}
