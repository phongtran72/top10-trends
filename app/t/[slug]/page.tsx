import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatformBadges } from "@/components/PlatformBadges";
import { RankHistory } from "@/components/RankHistory";
import { RegionTabs } from "@/components/RegionTabs";
import { RelativeTime } from "@/components/RelativeTime";
import { DEFAULT_VIEW, VIEWS } from "@/config/ranking";
import { getTopicDetail } from "@/lib/cached";
import { hostOf } from "@/lib/format";
import { parseView, VIEW_NAMES, viewQuery } from "@/lib/view";
import styles from "./page.module.css";

// Renders per request, because it reads `?region=` (the view), so nothing is
// built at build time. Its data comes from the cache under the `trends` tag,
// which the pipeline expires after each run.

export async function generateMetadata({ params }: PageProps<"/t/[slug]">): Promise<Metadata> {
  const detail = await getTopicDetail((await params).slug, DEFAULT_VIEW);
  if (!detail) return {};
  return {
    title: detail.label,
    description: detail.summary ?? `Where “${detail.label}” is trending across platforms, and how its rank changed this week.`,
  };
}

export default async function TopicPage({ params, searchParams }: PageProps<"/t/[slug]">) {
  const { slug } = await params;
  const view = parseView((await searchParams).region);
  const detail = await getTopicDetail(slug, view);
  if (!detail) notFound();
  const end = detail.history.at(-1)?.at ?? detail.lastSeen;

  return (
    <>
      <p className={styles.kicker}>
        {detail.currentRank !== null ? `#${detail.currentRank} across platforms` : "Topic"} · first seen{" "}
        <RelativeTime iso={detail.firstSeen} />
      </p>
      <h1 className="page-title">{detail.label}</h1>
      {detail.summary && <p className="lede">{detail.summary}</p>}
      <RegionTabs
        label="View"
        tabs={VIEWS.map((v) => ({ href: `/t/${detail.slug}${viewQuery(v)}`, label: VIEW_NAMES[v], current: v === view }))}
      />

      <section className={styles.section} aria-labelledby="now">
        <h2 id="now">Trending now on</h2>
        {detail.platforms.length > 0 ? (
          <div className={styles.badges}>
            <PlatformBadges platforms={detail.platforms} />
          </div>
        ) : (
          <p className={styles.empty}>
            Not in any platform&apos;s top 10 right now. Last seen <RelativeTime iso={detail.lastSeen} />.
          </p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="history">
        <h2 id="history">Rank across platforms, last 7 days</h2>
        <RankHistory history={detail.history} end={end} />
      </section>

      <section className={styles.section} aria-labelledby="links">
        <h2 id="links">Links</h2>
        {detail.links.length > 0 ? (
          <div className={styles.linkGroups}>
            {detail.links.map((group) => (
              <div key={group.sourceId} className={styles.linkGroup}>
                <h3>
                  <Link href={`/p/${group.slug}`}>{group.name}</Link>
                </h3>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.url}>
                      <a href={item.url} rel="noopener noreferrer" target="_blank">
                        {item.title}
                      </a>
                      <span className={styles.linkMeta}>
                        {" "}
                        · best #{item.rank} · {hostOf(item.url)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>No links are stored any more; items are kept for 28 days.</p>
        )}
      </section>

      <p className={styles.back}>
        <Link href={`/${viewQuery(view)}`}>← Back to the top 10</Link>
      </p>
    </>
  );
}
