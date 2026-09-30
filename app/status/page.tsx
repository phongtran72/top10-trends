import type { Metadata } from "next";
import { connection } from "next/server";
import { RelativeTime } from "@/components/RelativeTime";
import { getSourceStatuses } from "@/lib/cached";
import { successRate } from "@/lib/format";
import type { SourceStatus } from "@/lib/queries";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Status",
  description: "When each source last succeeded, its last error and its success rate over 24 hours.",
};

function health(status: SourceStatus): { label: string; tone: "ok" | "warn" | "bad" | "idle" } {
  if (status.runs24h === 0) return { label: status.phase > 1 ? `Phase ${status.phase}` : "No runs", tone: "idle" };
  const rate = status.ok24h / status.runs24h;
  if (rate >= 0.95) return { label: "Healthy", tone: "ok" };
  if (rate >= 0.5) return { label: "Degraded", tone: "warn" };
  return { label: "Failing", tone: "bad" };
}

export default async function StatusPage() {
  // Render per request, never at build time; the data itself is cached and
  // refreshed by the pipeline's revalidate call.
  await connection();
  const statuses = await getSourceStatuses();

  return (
    <>
      <h1 className="page-title">Status</h1>
      <p className="lede">
        Last successful fetch per source, its latest error and the share of runs that succeeded in the last 24 hours.
        A stale list is labeled here instead of being silently wrong.
      </p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Last success</th>
              <th scope="col">24 h</th>
              <th scope="col">Last error</th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((status) => {
              const { label, tone } = health(status);
              return (
                <tr key={status.id}>
                  <th scope="row">
                    <span className={styles.name}>{status.role === "system" ? "Pipeline heartbeat" : status.name}</span>
                    <span className={`${styles.badge} ${styles[tone]}`}>{label}</span>
                  </th>
                  <td>{status.lastSuccessAt ? <RelativeTime iso={status.lastSuccessAt} /> : <span className="muted">never</span>}</td>
                  <td>
                    {status.runs24h > 0 ? (
                      <>
                        {successRate(status.ok24h, status.runs24h)}{" "}
                        <span className="muted">
                          ({status.ok24h}/{status.runs24h})
                        </span>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className={styles.error}>
                    {status.lastError ? (
                      <>
                        <RelativeTime iso={status.lastError.at} />: <code>{status.lastError.message}</code>
                      </>
                    ) : (
                      <span className="muted">none</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
