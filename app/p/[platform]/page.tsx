import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { COLLECTORS } from "@/collectors/index";
import { pageRegion, platformBySlug, platformSlug, type SourceDef } from "@/collectors/registry";
import { RegionTabs } from "@/components/RegionTabs";
import { RelativeTime } from "@/components/RelativeTime";
import { getPlatformList } from "@/lib/cached";
import { hostOf, metricText, REGION_NAMES } from "@/lib/format";
import { feedQuery, parseFeed } from "@/lib/view";
import { WINDOWED_SOURCES } from "@/lib/window";
import styles from "./page.module.css";

// Renders per request, because it reads `?region=` (which of the source's
// feeds to show), so `next build` never queries the database. Its list comes
// from the cache under the `trends` tag, which the pipeline expires after
// each run.

export async function generateMetadata({ params }: PageProps<"/p/[platform]">): Promise<Metadata> {
  const source = platformBySlug((await params).platform);
  if (!source) return {};
  return {
    title: `${source.name} top 10`,
    description: `The top 10 on ${source.name} right now, ${orderText(source)}, refreshed every hour.`,
    alternates: { canonical: `/p/${platformSlug(source.id)}` },
  };
}

// How the list is ordered: the source's own ranking, or, for a source whose
// feed is in time order (Google Trends), its last few hours by volume.
function orderText(source: SourceDef): string {
  const hours = WINDOWED_SOURCES.get(source.id);
  return hours === undefined ? `in ${source.name}'s own order` : `the last ${hours} hours' trends by search volume`;
}

export default async function PlatformPage({ params, searchParams }: PageProps<"/p/[platform]">) {
  const source = platformBySlug((await params).platform);
  if (!source) notFound();
  const feed = parseFeed(source, (await searchParams).region);
  const list = await getPlatformList(source.id, feed);
  const region = REGION_NAMES[feed];

  return (
    <>
      <h1 className="page-title">{source.name} top 10</h1>
      <p className="lede">
        {region} · {orderText(source)} ·{" "}
        {list ? <RelativeTime iso={list.fetchedAt} prefix="updated" /> : "no list yet"}
      </p>
      {source.regions.length > 1 && (
        <RegionTabs
          label="Feed"
          tabs={[pageRegion(source), ...source.regions.filter((r) => r !== pageRegion(source))].map((r) => ({
            href: `/p/${platformSlug(source.id)}${feedQuery(source, r)}`,
            label: REGION_NAMES[r],
            current: r === feed,
          }))}
        />
      )}
      {source.note && <p className={styles.note}>{source.note}</p>}

      {list ? (
        <ol className={styles.list}>
          {list.items.map((item) => {
            const metric = metricText(item.metricValue, item.metricLabel);
            const host = hostOf(item.url);
            return (
              <li key={item.rank} className={styles.item}>
                <span className={styles.rank}>{item.rank}</span>
                <div className={styles.body}>
                  <a href={item.url} className={styles.title} rel="noopener noreferrer" target="_blank">
                    {item.title}
                  </a>
                  <p className={styles.meta}>
                    {[metric, host].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={styles.empty}>
          {!COLLECTORS.has(source.id)
            ? `${source.name} arrives in a later phase.`
            : `No ${source.name} list for ${region} has been collected yet. Check the status page.`}
        </p>
      )}

      <p className={styles.attribution}>
        Data from{" "}
        {source.homepage ? (
          <a href={source.homepage} rel="noopener noreferrer" target="_blank">
            {source.name}
          </a>
        ) : (
          source.name
        )}
        . <Link href="/status">Source status</Link>
      </p>
    </>
  );
}
