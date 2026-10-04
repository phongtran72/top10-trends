import Link from "next/link";
import styles from "./trends.module.css";

export interface RegionTab {
  href: string;
  label: string;
  current: boolean;
}

// A row of links that switch the view (Global or United States) or which of
// a platform's feeds its page shows. Plain links, so they work without
// JavaScript and each choice has its own URL (`?region=`).
export function RegionTabs({ tabs, label }: { tabs: RegionTab[]; label: string }) {
  return (
    <nav className={styles.tabs} aria-label={label}>
      {tabs.map((tab) => (
        <Link
          key={tab.label}
          href={tab.href}
          className={tab.current ? `${styles.tab} ${styles.tabCurrent}` : styles.tab}
          aria-current={tab.current ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
