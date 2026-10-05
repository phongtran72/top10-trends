import Link from "next/link";
import type { SourceAlert } from "@/lib/alerts";
import { RelativeTime } from "./RelativeTime";
import styles from "./trends.module.css";

// Shown on the home and status pages when a source, or the hourly update
// itself, has been failing for six hours or more (task 4.3), so a stale list
// is labeled instead of silently wrong.
export function FailureBanner({ alerts, linkToStatus = true }: { alerts: SourceAlert[]; linkToStatus?: boolean }) {
  if (alerts.length === 0) return null;
  const pipeline = alerts.find((alert) => alert.system);
  const sources = alerts.filter((alert) => !alert.system);
  const since = (alert: SourceAlert) =>
    alert.lastSuccessAt ? (
      <>
        last worked <RelativeTime iso={alert.lastSuccessAt} />
      </>
    ) : (
      "has never worked"
    );

  return (
    <aside className={styles.banner} role="status">
      <strong className={styles.bannerLabel}>Out of date</strong>
      {pipeline ? (
        <p>
          The hourly update has stopped ({since(pipeline)}), so every list on this site is older than it looks.
        </p>
      ) : (
        <p>
          {sources.length === 1 ? "One source is failing: " : `${sources.length} sources are failing: `}
          {sources.map((alert, index) => (
            <span key={alert.id}>
              {index > 0 ? "; " : ""}
              {alert.name} ({since(alert)})
            </span>
          ))}
          . {sources.length === 1 ? "Its list is" : "Their lists are"} out of date and {sources.length === 1 ? "isn't" : "aren't"} counted in the top 10.
        </p>
      )}
      {linkToStatus && (
        <Link href="/status" className={styles.bannerLink}>
          Source status →
        </Link>
      )}
    </aside>
  );
}
