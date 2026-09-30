import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatformBadges } from "@/components/PlatformBadges";
import { RankHistory } from "@/components/RankHistory";
import { RelativeTime } from "@/components/RelativeTime";
import { getDb } from "@/lib/db";
import { hostOf } from "@/lib/format";
import { topicDetail } from "@/lib/topic-queries";
import styles from "./page.module.css";

// ISR, like /p/[platform]: no page is built at build time; each renders on its
// first visit, is cached, and is refreshed when the pipeline revalidates
// /t/[slug] after a run.
export const revalidate = 3600;

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/t/[slug]">): Promise<Metadata> {
  const detail = await topicDetail(getDb(), (await params).slug);
  if (!detail) return {};
  return {
    title: detail.label,
    description: detail.summary ?? `Where “${detail.label}” is trending across platforms, and how its rank changed this week.`,
  };
}

export default async function TopicPage({ params }: PageProps<"/t/[slug]">) {
  const detail = await topicDetail(getDb(), (await params).slug);
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
        <Link href="/">← Back to the top 10</Link>
      </p>
    </>
  );
}
