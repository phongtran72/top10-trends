import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/LocalTime";
import { RegionTabs } from "@/components/RegionTabs";
import { VIEWS, type View } from "@/config/ranking";
import { parseDay, type ArchiveList } from "@/lib/archive-queries";
import { getArchiveDay, getArchiveDays, getArchivePlatformLists } from "@/lib/cached";
import { dayName, REGION_NAMES } from "@/lib/format";
import { parseView, VIEW_NAMES, viewQuery } from "@/lib/view";
import styles from "../archive.module.css";

// One UTC day of the archive (task 4.1): each hour's combined top 10 for the
// chosen view (`?region=us`), or, with `?hour=14`, that hour's list beside
// every platform's own list. Renders per request, because it reads the query
// string, from data cached under the `trends` tag.

export async function generateMetadata({ params }: PageProps<"/archive/[date]">): Promise<Metadata> {
  const { date } = await params;
  if (!parseDay(date)) return {};
  return {
    title: `Top 10s on ${dayName(date)}`,
    description: `Every hourly top 10 across platforms on ${dayName(date)}.`,
  };
}

function TopTen({ list, view }: { list: ArchiveList; view: string }) {
  return (
    <ol className={styles.entries}>
      {list.entries.map((entry) => (
        <li key={entry.rank}>
          <span className={styles.rank}>{entry.rank}</span>
          <Link href={`/t/${entry.slug}${view}`}>{entry.label}</Link>
        </li>
      ))}
    </ol>
  );
}

const hourOf = (list: ArchiveList) => Number(list.at.slice(11, 13));

export default async function ArchiveDay({ params, searchParams }: PageProps<"/archive/[date]">) {
  const { date } = await params;
  if (!parseDay(date)) notFound();
  const query = await searchParams;
  const view = parseView(query.region);
  const hourParam = Array.isArray(query.hour) ? query.hour[0] : query.hour;
  const hour = hourParam !== undefined && /^\d{1,2}$/.test(hourParam) ? Number(hourParam) : null;

  const days = (await getArchiveDays()).map((day) => day.date);
  const { lists, platformListsKept } = await getArchiveDay(date, view);
  const position = days.indexOf(date);
  const newer = position > 0 ? days[position - 1] : null;
  const older = position !== -1 && position < days.length - 1 ? days[position + 1] : null;
  const here = `/archive/${date}`;
  // A link that keeps the view (and, when given, the hour) in its query string.
  const url = (path: string, extra = "", v: View = view) => {
    const parts = [viewQuery(v).slice(1), extra].filter(Boolean);
    return parts.length > 0 ? `${path}?${parts.join("&")}` : path;
  };

  const chosen = hour === null ? null : (lists.find((list) => hourOf(list) === hour) ?? null);
  const platformLists = chosen && platformListsKept ? await getArchivePlatformLists(chosen.at) : [];

  return (
    <>
      <p className={styles.kicker}>
        <Link href="/archive">Archive</Link>
        {older && (
          <>
            {" · "}
            <Link href={url(`/archive/${older}`)}>← {dayName(older, "short")}</Link>
          </>
        )}
        {newer && (
          <>
            {" · "}
            <Link href={url(`/archive/${newer}`)}>{dayName(newer, "short")} →</Link>
          </>
        )}
      </p>
      <h1 className="page-title">{dayName(date)}</h1>
      <p className="lede">
        {chosen ? "The top 10 across platforms at one hour, beside each platform's own list." : "Every hourly top 10 across platforms on this day (a UTC day)."}{" "}
        Times are in your time zone.
      </p>
      <RegionTabs
        label="View"
        tabs={VIEWS.map((v) => ({ href: url(here, chosen ? `hour=${hour}` : "", v), label: VIEW_NAMES[v], current: v === view }))}
      />

      {lists.length === 0 ? (
        <p className={styles.empty}>No {VIEW_NAMES[view]} top 10 was recorded on this day.</p>
      ) : chosen ? (
        <>
          <section className={styles.section} aria-labelledby="combined">
            <h2 id="combined">
              Top 10 across platforms · <LocalTime iso={chosen.at} />
            </h2>
            <TopTen list={chosen} view={viewQuery(view)} />
            <p className={styles.more}>
              <Link href={url(here)}>← Every hour of this day</Link>
            </p>
          </section>
          <section className={styles.section} aria-labelledby="platforms">
            <h2 id="platforms">Each platform at that hour</h2>
            {platformLists.length > 0 ? (
              <div className={styles.cards}>
                {platformLists.map((list) => (
                  <article key={list.sourceId} className={styles.card}>
                    <h3>
                      <Link href={`/p/${list.slug}`}>{list.name}</Link> <span className={styles.feed}>{REGION_NAMES[list.feed]}</span>
                    </h3>
                    <ol className={styles.entries}>
                      {list.items.map((item) => (
                        <li key={item.rank}>
                          <span className={styles.rank}>{item.rank}</span>
                          <a href={item.url} rel="noopener noreferrer" target="_blank">
                            {item.title}
                          </a>
                        </li>
                      ))}
                    </ol>
                  </article>
                ))}
              </div>
            ) : (
              <p className={styles.empty}>Platform lists are kept for 28 days, so this hour&apos;s are no longer stored.</p>
            )}
          </section>
        </>
      ) : (
        <div className={styles.cards}>
          {[...lists].reverse().map((list) => (
            <article key={list.at} className={styles.card}>
              <h2 className={styles.hour}>
                <LocalTime iso={list.at} />
              </h2>
              <TopTen list={list} view={viewQuery(view)} />
              {platformListsKept && (
                <Link href={url(here, `hour=${hourOf(list)}`)} className={styles.more}>
                  Each platform at this hour →
                </Link>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
