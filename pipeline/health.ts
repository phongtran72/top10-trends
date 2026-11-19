import { and, desc, eq, gt, gte, max, or } from "drizzle-orm";
import { fetchRuns } from "@/db/schema";
import { ALERT_AFTER_HOURS } from "@/lib/alerts";
import type { Db } from "./db";

// The missing-list alarm (task 4.13). Twice a day the `health` workflow,
// started by the Cloudflare Worker, checks every list the pipeline fetches and
// fails when one has gone 6 hours or more without a stored list, or when the
// hourly update itself has stopped. The run counts as the owner's (it is
// started with their token), so GitHub emails them when it fails: nobody reads
// /status, which is how the Apify outage of 2026-11-12 ran six days unseen.
// The Apify-backed lists also fail their fetch once the actor's newest run is
// older than its schedule allows (24 hours for Instagram, 48 for TikTok, 180
// for Pinterest), so a stopped schedule on Apify's side alarms 6 hours after
// that.

const HOUR_MS = 60 * 60 * 1000;

export const HEARTBEAT = "heartbeat";

// A list is checked while it has run in the last 48 hours: one taken out of
// the code stops alarming two days later, and one that stops being fetched by
// mistake alarms for those two days. The hourly update itself is always
// checked, so a pipeline that stopped altogether keeps alarming.
export const HEALTH_LOOKBACK_HOURS = 48;

export interface ListState {
  sourceId: string;
  region: string;
  lastRunAt: Date; // the newest run's start
  lastStatus: string; // ok | error | skipped
  lastError: string | null; // status code, host and a short reason (invariant 12)
  // The newest run that stored a list (for the heartbeat: the newest run that finished).
  lastGoodAt: Date | null;
}

export interface MissingList extends ListState {
  hoursMissing: number | null; // since the last good run; null when there was none
}

// The lists missing for `hours` or more. A list switched off on purpose (its
// newest run `skipped`: listed in DISABLED_SOURCES, or its key not set) never
// alarms. The hourly update comes first: when it has stopped, the rest follows.
export function missingLists(states: readonly ListState[], now: Date, hours = ALERT_AFTER_HOURS): MissingList[] {
  const cutoff = now.getTime() - hours * HOUR_MS;
  return states
    .filter((state) => state.lastStatus !== "skipped")
    .filter((state) => state.lastGoodAt === null || state.lastGoodAt.getTime() <= cutoff)
    .map((state) => ({
      ...state,
      hoursMissing: state.lastGoodAt === null ? null : (now.getTime() - state.lastGoodAt.getTime()) / HOUR_MS,
    }))
    .sort(
      (a, b) =>
        Number(b.sourceId === HEARTBEAT) - Number(a.sourceId === HEARTBEAT) ||
        a.sourceId.localeCompare(b.sourceId) ||
        a.region.localeCompare(b.region),
    );
}

// Every list that ran in the last 48 hours, and the hourly update, from fetch_runs.
export async function listStates(db: Db, now: Date): Promise<ListState[]> {
  const since = new Date(now.getTime() - HEALTH_LOOKBACK_HOURS * HOUR_MS);
  const columns = {
    sourceId: fetchRuns.sourceId,
    region: fetchRuns.region,
    startedAt: fetchRuns.startedAt,
    status: fetchRuns.status,
    error: fetchRuns.error,
  };
  const recent = await db
    .select(columns)
    .from(fetchRuns)
    .where(gte(fetchRuns.startedAt, since))
    .orderBy(desc(fetchRuns.startedAt), desc(fetchRuns.id));
  const [heartbeat] = await db
    .select(columns)
    .from(fetchRuns)
    .where(eq(fetchRuns.sourceId, HEARTBEAT))
    .orderBy(desc(fetchRuns.startedAt), desc(fetchRuns.id))
    .limit(1);
  const good = await db
    .select({ sourceId: fetchRuns.sourceId, region: fetchRuns.region, at: max(fetchRuns.startedAt) })
    .from(fetchRuns)
    .where(and(eq(fetchRuns.status, "ok"), or(gt(fetchRuns.itemCount, 0), eq(fetchRuns.sourceId, HEARTBEAT))))
    .groupBy(fetchRuns.sourceId, fetchRuns.region);
  const goodAt = new Map(good.map((row) => [`${row.sourceId}/${row.region}`, row.at]));

  const newest = new Map<string, (typeof recent)[number]>();
  for (const row of [...(heartbeat ? [heartbeat] : []), ...recent]) {
    const key = `${row.sourceId}/${row.region}`;
    if (!newest.has(key)) newest.set(key, row); // newest first
  }
  return [...newest].map(([key, row]) => ({
    sourceId: row.sourceId,
    region: row.region,
    lastRunAt: row.startedAt,
    lastStatus: row.status,
    lastError: row.error,
    lastGoodAt: goodAt.get(key) ?? null,
  }));
}

// "Nov 19, 5:08 AM New York (10:08 UTC)": the owner reads New York time.
export function when(at: Date): string {
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
  return `${local} New York (${at.toISOString().slice(11, 16)} UTC)`;
}

function hoursText(hours: number): string {
  return hours < 48 ? `${Math.floor(hours)} h` : `${Math.floor(hours / 24)} days`;
}

// One line about a missing list, for the log and the run's annotations.
export function describeMissing(list: MissingList): string {
  const name = list.sourceId === HEARTBEAT ? "the hourly update" : `${list.sourceId}/${list.region}`;
  const since =
    list.lastGoodAt === null || list.hoursMissing === null
      ? `has had no ${list.sourceId === HEARTBEAT ? "finished run" : "list"} in ${HEALTH_LOOKBACK_HOURS} h`
      : `has had no ${list.sourceId === HEARTBEAT ? "finished run" : "list"} for ${hoursText(list.hoursMissing)} (last ${when(list.lastGoodAt)})`;
  const newest =
    list.sourceId === HEARTBEAT
      ? ""
      : `; its newest run, ${when(list.lastRunAt)}, ${list.lastStatus === "error" && list.lastError ? `failed: ${list.lastError}` : `was ${list.lastStatus}`}`;
  return `${name} ${since}${newest}`;
}

export function formatHealth(states: readonly ListState[], missing: readonly MissingList[], now: Date): string[] {
  const off = states.filter((state) => state.lastStatus === "skipped").map((state) => `${state.sourceId}/${state.region}`);
  const lists = states.filter((state) => state.sourceId !== HEARTBEAT).length;
  const lines = [
    `health: ${lists} lists checked at ${when(now)}` +
      (off.length > 0 ? `; switched off: ${off.join(", ")}` : "") +
      (missing.length === 0 ? "; none missing" : `; ${missing.length} missing`),
  ];
  for (const list of missing) lines.push(`MISSING: ${describeMissing(list)}`);
  return lines;
}
