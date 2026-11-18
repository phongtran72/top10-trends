export interface Env {
  GH_OWNER: string;
  GH_REPO: string;
  GH_DISPATCH_TOKEN: string;
}

// The hourly start. The other crons in wrangler.toml are catch-up tries.
export const PRIMARY_CRON = "7 * * * *";

// The fields read from GitHub's list of workflow runs.
export interface CollectRun {
  status: string | null;
  conclusion: string | null;
  created_at: string;
}

function workflowUrl(env: Env): string {
  return `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/actions/workflows/collect.yml`;
}

function headers(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "top10-trends-cron",
  };
}

// Starts one run of the `collect` workflow on main.
export function dispatchCollect(env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  return fetcher(`${workflowUrl(env)}/dispatches`, {
    method: "POST",
    headers: { ...headers(env), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main" }),
  });
}

// The newest runs of the `collect` workflow, newest first.
export function listCollectRuns(env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  return fetcher(`${workflowUrl(env)}/runs?per_page=10`, { headers: headers(env) });
}

// Whether the clock hour of `now` (UTC) already has a run that succeeded or
// hasn't finished yet, however long it has been queued or running: during
// GitHub's Actions incident of 2026-10-19 the 16:07 run sat unfinished until
// 16:30, and starting more runs beside it gave that hour three. So a catch-up
// try starts a run only when the hour has none, or every one failed or was
// cancelled. A dry run started by hand counts too: GitHub's list doesn't
// tell the two apart.
export function hourCovered(runs: readonly CollectRun[], now: Date): boolean {
  const hourStart = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
  return runs.some((run) => {
    if (!(Date.parse(run.created_at) >= hourStart)) return false;
    return run.status !== "completed" || run.conclusion === "success";
  });
}

// One cron firing. The primary cron always starts a run. A catch-up try starts
// one only when GitHub's own list shows the hour has no good run: when the
// start was refused, or the run failed or never got going. If the list can't
// be read it starts nothing, so an outage of the list never doubles the runs.
export async function onCron(cron: string, scheduledTime: number, env: Env, fetcher: typeof fetch = fetch): Promise<"dispatched" | "covered"> {
  if (!env.GH_DISPATCH_TOKEN) {
    throw new Error("GH_DISPATCH_TOKEN is not set; run the deploy-worker workflow (SETUP.md §6)");
  }
  const at = new Date(scheduledTime);
  if (cron !== PRIMARY_CRON) {
    const listed = await listCollectRuns(env, fetcher);
    if (!listed.ok) throw new Error(`collect runs could not be read: ${listed.status}`);
    const runs = ((await listed.json()) as { workflow_runs?: CollectRun[] }).workflow_runs ?? [];
    if (runs.length === 0) throw new Error("collect runs could not be read: empty list");
    if (hourCovered(runs, at)) return "covered";
    console.log(`collect catch-up for ${at.toISOString()}: no good run this hour`);
  }
  const response = await dispatchCollect(env, fetcher);
  if (!response.ok) {
    // GitHub's error body holds a message and a docs link, never the token.
    const body = (await response.text()).slice(0, 300);
    console.error(`collect dispatch failed: ${response.status} ${body}`);
    throw new Error(`collect dispatch failed: ${response.status}`);
  }
  console.log(`collect dispatched for ${at.toISOString()}`);
  return "dispatched";
}

export default {
  async scheduled(controller, env) {
    await onCron(controller.cron, controller.scheduledTime, env);
  },
} satisfies ExportedHandler<Env>;
