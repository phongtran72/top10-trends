import type { SourceStatus } from "@/lib/queries";

// Failure alerts (task 4.3): which sources have been failing long enough to
// tell visitors. One failed fetch is normal; six hours without a success
// means a list on the site is stale.

export const ALERT_AFTER_HOURS = 6;

export interface SourceAlert {
  id: string;
  name: string;
  system: boolean; // the pipeline's own heartbeat: no hourly update at all
  lastSuccessAt: string | null; // null when the source has never succeeded
}

// A source alerts when it is in use, its newest run failed and it hasn't
// succeeded for `hours`. The heartbeat alerts when no run has finished for
// that long, whatever its last status was: a stopped pipeline writes no rows.
// A skipped source (missing keys, or switched off) never alerts.
export function failingSources(statuses: readonly SourceStatus[], now: Date, hours = ALERT_AFTER_HOURS): SourceAlert[] {
  const cutoff = now.getTime() - hours * 60 * 60 * 1000;
  const alerts: SourceAlert[] = [];
  for (const status of statuses) {
    if (status.lastRunAt === null || status.lastStatus === "skipped") continue;
    const system = status.role === "system";
    const failing =
      status.lastSuccessAt === null
        ? // Never succeeded: alert once its failed runs span the same six hours.
          status.runs24h >= hours && status.ok24h === 0
        : Date.parse(status.lastSuccessAt) <= cutoff && (system || status.lastStatus === "error");
    if (failing) alerts.push({ id: status.id, name: system ? "The hourly update" : status.name, system, lastSuccessAt: status.lastSuccessAt });
  }
  // The pipeline first: when it has stopped, nothing else matters.
  return alerts.sort((a, b) => Number(b.system) - Number(a.system));
}
