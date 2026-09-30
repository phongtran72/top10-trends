export interface Env {
  GH_OWNER: string;
  GH_REPO: string;
  GH_DISPATCH_TOKEN: string;
}

// Starts one run of the `collect` workflow on main.
export function dispatchCollect(env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/actions/workflows/collect.yml/dispatches`;
  return fetcher(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "top10-trends-cron",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });
}

export default {
  async scheduled(controller, env) {
    if (!env.GH_DISPATCH_TOKEN) {
      throw new Error("GH_DISPATCH_TOKEN is not set; run the deploy-worker workflow (SETUP.md §6)");
    }
    const response = await dispatchCollect(env);
    if (!response.ok) {
      // GitHub's error body holds a message and a docs link, never the token.
      const body = (await response.text()).slice(0, 300);
      console.error(`collect dispatch failed: ${response.status} ${body}`);
      throw new Error(`collect dispatch failed: ${response.status}`);
    }
    console.log(`collect dispatched for ${new Date(controller.scheduledTime).toISOString()}`);
  },
} satisfies ExportedHandler<Env>;
