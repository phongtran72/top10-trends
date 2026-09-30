import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { COLLECTORS } from "@/collectors/index";
import { pageRegion, platformBySlug } from "@/collectors/registry";
import { RelativeTime } from "@/components/RelativeTime";
import { getDb } from "@/lib/db";
import { hostOf, metricText, REGION_NAMES } from "@/lib/format";
import { platformList } from "@/lib/queries";
import styles from "./page.module.css";

// ISR: no page is rendered at build time (generateStaticParams returns []),
// so `next build` never queries the database. Each page renders on its first
// visit and is then served from cache until the pipeline revalidates
// /p/[platform] after a run; the hourly revalidate is a safety net.
export const revalidate = 3600;

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/p/[platform]">): Promise<Metadata> {
  const source = platformBySlug((await params).platform);
  if (!source) return {};
  return {
    title: `${source.name} top 10`,
    description: `The top 10 on ${source.name} right now, in ${source.name}'s own order, refreshed every hour.`,
  };
}

export default async function PlatformPage({ params }: PageProps<"/p/[platform]">) {
  const source = platformBySlug((await params).platform);
  if (!source) notFound();
  const list = await platformList(getDb(), source);
  const region = REGION_NAMES[pageRegion(source)];

  return (
    <>
      <h1 className="page-title">{source.name} top 10</h1>
      <p className="lede">
        {region} · in {source.name}&apos;s own order ·{" "}
        {list ? <RelativeTime iso={list.fetchedAt} prefix="updated" /> : "no list yet"}
      </p>

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
            : `No ${source.name} list has been collected yet. Check the status page.`}
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
