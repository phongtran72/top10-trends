import Link from "next/link";
import { connection } from "next/server";
import { COLLECTORS } from "@/collectors/index";
import { PLATFORMS } from "@/collectors/registry";
import { PlatformBadges } from "@/components/PlatformBadges";
import { RankChange } from "@/components/RankChange";
import { RelativeTime } from "@/components/RelativeTime";
import { getCombinedTop, getDashboard } from "@/lib/cached";
import type { DashboardEntry, Staying } from "@/lib/dashboard";
import { metricText, REGION_NAMES } from "@/lib/format";
import styles from "./page.module.css";

// The home page: the combined top 10 across platforms, then the dashboard
// (every platform at a glance and what changed since the last hourly list).
// It renders per request (never at build time) from data cached under the
// `trends` tag.

function Entry({ entry, children }: { entry: DashboardEntry | Staying; children?: React.ReactNode }) {
  return (
    <li className={styles.entry}>
      <div className={styles.entryMain}>
        <a href={entry.url} className={styles.entryTitle} rel="noopener noreferrer" target="_blank">
          {entry.title}
        </a>
        <p className={styles.entryMeta}>
          <Link href={`/p/${entry.slug}`}>{entry.name}</Link>
          {entry.rank !== null ? ` · #${entry.rank}` : " · dropped out"}
        </p>
      </div>
      {children}
    </li>
  );
}

function Meter({ value, max }: { value: number; max: number }) {
  const pct = Math.round((100 * value) / max);
  return (
    <div className={styles.meterWrap} title={`In the top 10 in ${value} of the last ${max} hourly lists`}>
      <span className={styles.meterLabel}>
        {value}/{max}
      </span>
      <span
        className={styles.meter}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label="Hourly lists with this item in the top 10"
      >
        <span className={styles.meterFill} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

export default async function Home() {
  await connection();
  const combined = await getCombinedTop();
  const data = await getDashboard();
  const later = PLATFORMS.filter((p) => !COLLECTORS.has(p.id)).map((p) => p.name);

  return (
    <>
      <h1 className="page-title">Top 10 Social Trends</h1>
      <p className="lede">
        What&apos;s trending on {data.platforms.length} platforms right now, refreshed every hour
        {data.updatedAt ? (
          <>
            {" "}
            · <RelativeTime iso={data.updatedAt} prefix="updated" />
          </>
        ) : null}
        .
      </p>

      {combined && combined.entries.length > 0 && (
        <section className={styles.section} aria-labelledby="combined">
          <h2 id="combined">Top 10 across platforms</h2>
          <p className={styles.note}>
            Topics ranked by how high they trend on each platform ·{" "}
            <RelativeTime iso={combined.computedAt} prefix="updated" />
          </p>
          <ol className={styles.combined}>
            {combined.entries.map((entry) => (
              <li key={entry.topicId} className={styles.topic}>
                <span className={styles.topicRank}>{entry.rank}</span>
                <div className={styles.topicBody}>
                  <Link href={`/t/${entry.slug}`} className={styles.topicLabel}>
                    {entry.label}
                  </Link>
                  {entry.summary && <p className={styles.topicSummary}>{entry.summary}</p>}
                  <PlatformBadges platforms={entry.platforms} />
                </div>
                <RankChange change={entry.change} compared={combined.compared} />
              </li>
            ))}
          </ol>
        </section>
      )}

      {data.highlights.length > 0 && (
        <section className={styles.section} aria-labelledby="highlights">
          <h2 id="highlights">Highlights</h2>
          <ul className={styles.tiles}>
            {data.highlights.map((h) => {
              const [value, ...unit] = (metricText(h.metricValue, h.metricLabel) ?? "").split(" ");
              return (
                <li key={h.sourceId} className={styles.tile}>
                  <p className={styles.tileLabel}>{h.label}</p>
                  <p className={styles.tileValue}>
                    {value} <span className={styles.tileUnit}>{unit.join(" ")}</span>
                  </p>
                  <a href={h.url} className={styles.tileTitle} rel="noopener noreferrer" target="_blank">
                    {h.title}
                  </a>
                  <p className={styles.tileSource}>
                    <Link href={`/p/${h.slug}`}>{h.name}</Link> · #{h.rank}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className={styles.section} aria-labelledby="right-now">
        <h2 id="right-now">Right now</h2>
        <div className={styles.cards}>
          {data.platforms.map((p) => (
            <article key={p.id} className={styles.card}>
              <header className={styles.cardHead}>
                <h3>
                  <Link href={`/p/${p.slug}`}>{p.name}</Link>
                </h3>
                <p className={styles.cardMeta}>
                  {REGION_NAMES[p.region]}
                  {p.fetchedAt ? (
                    <>
                      {" "}
                      · <RelativeTime iso={p.fetchedAt} />
                    </>
                  ) : null}
                </p>
              </header>
              {p.top.length > 0 ? (
                <ol className={styles.cardList}>
                  {p.top.map((item) => {
                    const metric = metricText(item.metricValue, item.metricLabel);
                    return (
                      <li key={item.rank}>
                        <span className={styles.cardRank}>{item.rank}</span>
                        <span className={styles.cardItem}>
                          <a href={item.url} rel="noopener noreferrer" target="_blank">
                            {item.title}
                          </a>
                          {metric && <span className={styles.cardMetric}>{metric}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className={styles.cardEmpty}>No list in the last day. See the status page.</p>
              )}
              <Link href={`/p/${p.slug}`} className={styles.cardMore}>
                Full top 10 →
              </Link>
            </article>
          ))}
        </div>
      </section>

      <div className={styles.columns}>
        <section className={styles.section} aria-labelledby="new">
          <h2 id="new">New since the last update</h2>
          {data.newEntries.length > 0 ? (
            <ul className={styles.entries}>
              {data.newEntries.map((e) => (
                <Entry key={`${e.sourceId}-${e.rank}`} entry={e}>
                  <span className={styles.badgeNew}>new</span>
                </Entry>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>Nothing new since the previous hourly lists.</p>
          )}
        </section>

        <section className={styles.section} aria-labelledby="climbing">
          <h2 id="climbing">Climbing</h2>
          {data.movers.length > 0 ? (
            <ul className={styles.entries}>
              {data.movers.map((m) => (
                <Entry key={`${m.sourceId}-${m.rank}`} entry={m}>
                  <span className={styles.climb} title={`Up from #${m.previousRank}`}>
                    ▲ {m.previousRank - m.rank}
                  </span>
                </Entry>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>No climbers since the previous hourly lists.</p>
          )}
        </section>
      </div>

      <section className={styles.section} aria-labelledby="staying">
        <h2 id="staying">Staying power</h2>
        <p className={styles.note}>How many of the last day&apos;s hourly lists had each item in the top 10.</p>
        {data.staying.length > 0 ? (
          <ul className={styles.entries}>
            {data.staying.map((s) => (
              <Entry key={`${s.sourceId}-${s.title}`} entry={s}>
                <Meter value={s.lists} max={s.of} />
              </Entry>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>Needs at least two hourly lists.</p>
        )}
      </section>

      {later.length > 0 && <p className={styles.later}>Coming later: {later.join(", ")}.</p>}
    </>
  );
}
