import Link from "next/link";
import { PLATFORMS, platformSlug, type SourceDef } from "@/collectors/registry";
import { REGION_NAMES } from "@/lib/format";
import styles from "./page.module.css";

// Until phase 2 adds the combined top 10, the home page links to each
// platform's own list. It reads only the registry, so it is static.

const ROLE_LABELS: Record<SourceDef["role"], string> = {
  lead: "Lead",
  corroborating: "Corroborating",
  system: "System",
};

function regionLabel(source: SourceDef): string {
  return source.regions.includes("global") ? REGION_NAMES.global : REGION_NAMES[source.regions[0]];
}

export default function Home() {
  const live = PLATFORMS.filter((source) => source.phase <= 1);
  const later = PLATFORMS.filter((source) => source.phase > 1);
  return (
    <>
      <h1 className="page-title">Top 10 Social Trends</h1>
      <p className="lede">
        The top 10 trending topics on each platform, refreshed every hour. A combined top 10 across all of them is
        coming next.
      </p>

      <section className={styles.section} aria-labelledby="platforms">
        <h2 id="platforms">Platforms</h2>
        <ul className={styles.list}>
          {live.map((source) => (
            <li key={source.id}>
              <Link href={`/p/${platformSlug(source.id)}`} className={styles.item}>
                <span className={styles.name}>{source.name}</span>
                <span className={styles.meta}>{regionLabel(source)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="later">
        <h2 id="later">Coming later</h2>
        <p className={styles.note}>Paid, approval-gated or optional sources.</p>
        <ul className={styles.list}>
          {later.map((source) => (
            <li key={source.id} className={`${styles.item} ${styles.pending}`}>
              <span className={styles.name}>{source.name}</span>
              <span className={styles.meta}>{ROLE_LABELS[source.role]}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
