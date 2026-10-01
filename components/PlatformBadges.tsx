import Link from "next/link";
import type { PlatformRank } from "@/lib/topic-queries";
import styles from "./trends.module.css";

// Where a topic ranks on each platform, e.g. "Google Trends #2".
export function PlatformBadges({ platforms }: { platforms: PlatformRank[] }) {
  if (platforms.length === 0) return null;
  return (
    <ul className={styles.badges} aria-label="Platforms">
      {platforms.map((p) => (
        <li key={p.sourceId}>
          <Link href={`/p/${p.slug}`} className={styles.badge}>
            {p.name} <span className={styles.badgeRank}>#{p.rank}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
