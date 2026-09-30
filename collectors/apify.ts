import { z } from "zod";
import type { CollectorContext } from "./types";
import { requireKey } from "./util";

// TikTok and Instagram have no trends API for individuals, so Apify actors
// scrape them on schedules set up in Apify (SETUP.md §12). Their collectors
// only read the latest successful run's dataset: free, fast and well inside
// the 30-second budget, since the scraping itself happens on Apify's side.
const API = "https://api.apify.com/v2";

const LastRun = z.object({
  data: z.object({
    id: z.string(),
    finishedAt: z.string().nullable(),
    defaultDatasetId: z.string(),
  }),
});

// The dataset of an actor's latest successful run. Throws when that run
// finished more than maxAgeHours ago, which means its schedule stopped.
export async function latestApifyItems(
  actor: string,
  options: { label: string; maxAgeHours: number },
  { http, env, now }: CollectorContext,
): Promise<unknown> {
  const headers = { Authorization: `Bearer ${requireKey(env, "APIFY_TOKEN")}` };
  const run = LastRun.parse(await http.getJson(`${API}/acts/${actor}/runs/last?status=SUCCEEDED`, { headers }));
  const finished = run.data.finishedAt ? new Date(run.data.finishedAt) : null;
  const ageHours = finished ? (now.getTime() - finished.getTime()) / 3_600_000 : Infinity;
  if (ageHours > options.maxAgeHours) {
    throw new Error(`latest ${options.label} run finished ${Math.round(ageHours)} h ago; check the Apify schedule`);
  }
  return http.getJson(`${API}/datasets/${run.data.defaultDatasetId}/items?clean=true`, { headers });
}
