import { and, eq, gte, inArray, like, lt, notLike } from "drizzle-orm";
import { z } from "zod";
import { APIFY_API } from "@/collectors/apify";
import { INSTAGRAM_ACTOR } from "@/collectors/instagram";
import { PINTEREST_ACTOR } from "@/collectors/pinterest";
import { TIKTOK_ACTOR } from "@/collectors/tiktok";
import type { SourceId } from "@/collectors/registry";
import type { Region, TrendItem } from "@/collectors/types";
import { fetchRuns, trendItems } from "@/db/schema";
import type { Http } from "@/lib/http";
import { itemRow } from "./collect";
import type { Db } from "./db";

// Recovering the lists that the Apify-backed sources missed (task 4.12). The
// actors keep running on Apify's schedules whatever happens on our side, and
// Apify keeps their recent runs (about 10 days on the free plan). So after an
// outage of ours, such as the bad token of 2026-11-12 to 11-18, each failed
// hour can still get the list a live run would have read: the actor's latest
// run that had finished by then. The collectors map it unchanged; only their
// lookup of the latest run is pointed at that run.

export const APIFY_ACTORS: Readonly<Partial<Record<SourceId, string>>> = {
  instagram: INSTAGRAM_ACTOR,
  tiktok: TIKTOK_ACTOR,
  pinterest: PINTEREST_ACTOR,
};

// The hours keep `error`: their snapshots were ranked without these lists. The
// note is appended to the original error, worded the same on every row so
// research can key on it.
export const RECOVERED_NOTE = "; list recovered";

export interface ApifyRun {
  id: string;
  finishedAt: Date;
  defaultDatasetId: string;
}

const RunList = z.object({
  data: z.object({
    items: z.array(z.object({ id: z.string(), finishedAt: z.string().nullable(), defaultDatasetId: z.string() })),
  }),
});

// An actor's succeeded runs, newest first. Apify keeps far fewer than 1,000.
export async function listApifyRuns(http: Http, token: string, actor: string): Promise<ApifyRun[]> {
  const body = RunList.parse(
    await http.getJson(`${APIFY_API}/acts/${actor}/runs?status=SUCCEEDED&desc=1&limit=1000`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  return body.data.items.flatMap((run) =>
    run.finishedAt ? [{ id: run.id, finishedAt: new Date(run.finishedAt), defaultDatasetId: run.defaultDatasetId }] : [],
  );
}

// The run a live run at `at` would have read: the latest one finished by then.
export function runAt(runs: readonly ApifyRun[], at: Date): ApifyRun | null {
  let best: ApifyRun | null = null;
  for (const run of runs) {
    if (run.finishedAt.getTime() <= at.getTime() && (!best || run.finishedAt.getTime() > best.finishedAt.getTime())) best = run;
  }
  return best;
}

// The collectors' http, with their lookup of the actor's latest run answered
// by `run`. Everything else, the dataset included, goes to `http`.
export function pinnedHttp(http: Http, actor: string, run: ApifyRun): Http {
  const last = `${APIFY_API}/acts/${actor}/runs/last?status=SUCCEEDED`;
  return {
    getJson: (url, options) =>
      url === last
        ? Promise.resolve({ data: { id: run.id, finishedAt: run.finishedAt.toISOString(), defaultDatasetId: run.defaultDatasetId } })
        : http.getJson(url, options),
    getXml: (url, options) => http.getXml(url, options),
    postFormJson: (url, form, options) => http.postFormJson(url, form, options),
  };
}

export interface MissedHour {
  runId: number;
  sourceId: SourceId;
  region: Region;
  startedAt: Date;
  finishedAt: Date;
  error: string;
}

// The Apify sources' fetch_runs rows in [from, to) that failed with Apify's
// 401 and haven't been recovered yet, oldest first.
export async function missedHours(db: Db, from: Date, to: Date): Promise<MissedHour[]> {
  const rows = await db
    .select({
      runId: fetchRuns.id,
      sourceId: fetchRuns.sourceId,
      region: fetchRuns.region,
      startedAt: fetchRuns.startedAt,
      finishedAt: fetchRuns.finishedAt,
      error: fetchRuns.error,
    })
    .from(fetchRuns)
    .where(
      and(
        inArray(fetchRuns.sourceId, Object.keys(APIFY_ACTORS)),
        eq(fetchRuns.status, "error"),
        like(fetchRuns.error, "401 api.apify.com%"),
        notLike(fetchRuns.error, `%${RECOVERED_NOTE}%`),
        gte(fetchRuns.startedAt, from),
        lt(fetchRuns.startedAt, to),
      ),
    )
    .orderBy(fetchRuns.startedAt, fetchRuns.id);
  return rows.map((row) => ({
    runId: row.runId,
    sourceId: row.sourceId as SourceId,
    region: row.region as Region,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? row.startedAt,
    error: row.error ?? "",
  }));
}

// Stores a recovered list under the failed hour's own fetch_runs row, with
// that hour's time, and appends the note. Returns the items stored: 0 for an
// empty list (the row is left as it is) and when the row is no longer a
// failed, unrecovered one, so a second pass changes nothing.
export async function recoverHour(db: Db, hour: MissedHour, items: readonly TrendItem[]): Promise<number> {
  if (items.length === 0) return 0;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(fetchRuns)
      .set({ itemCount: items.length, error: `${hour.error}${RECOVERED_NOTE}` })
      .where(and(eq(fetchRuns.id, hour.runId), eq(fetchRuns.status, "error"), notLike(fetchRuns.error, `%${RECOVERED_NOTE}%`)))
      .returning({ id: fetchRuns.id });
    if (!row) return 0;
    await tx.insert(trendItems).values(items.map((item) => itemRow(item, hour.runId, hour.finishedAt)));
    return items.length;
  });
}
