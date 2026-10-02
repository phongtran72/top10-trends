import Link from "next/link";
import type { PlatformRank } from "@/lib/topic-queries";
import { RelativeTime } from "./RelativeTime";
import styles from "./trends.module.css";

// Where a topic ranks on each platform, e.g. "Google Trends #2". A topic that
// has left the platform's list but still counts shows when it was last
// listed, e.g. "Bluesky #1 · 1 h ago".
export function PlatformBadges({ platforms }: { platforms: PlatformRank[] }) {
  if (platforms.length === 0) return null;
  return (
    <ul className={styles.badges} aria-label="Platforms">
      {platforms.map((p) => (
        <li key={p.sourceId}>
          <Link
            href={`/p/${p.slug}`}
            className={styles.badge}
            title={p.seenAt ? `No longer on ${p.name}'s list; counted at the rank it was last seen with` : undefined}
          >
            {p.name} <span className={styles.badgeRank}>#{p.rank}</span>
            {p.seenAt ? (
              <>
                {" · "}
                <RelativeTime iso={p.seenAt} />
              </>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
