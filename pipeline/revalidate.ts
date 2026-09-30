import { REVALIDATE_HEADER } from "@/lib/revalidate";

// Last pipeline step: ask the site to refresh its cached pages. A failure is
// logged and never fails the run; the pages refresh on the next run instead.
export async function revalidateSite(
  target: { siteUrl: string; secret: string } | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!target) return "revalidate: skipped (SITE_URL or REVALIDATE_SECRET not set)";
  const url = `${target.siteUrl}/api/revalidate`;
  const host = new URL(url).host;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { [REVALIDATE_HEADER]: target.secret },
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel().catch(() => {});
    return response.ok ? `revalidate: ok (${host})` : `revalidate: failed: ${response.status} ${host}`;
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout after 10s" : "network error";
    return `revalidate: failed: ${host}: ${reason}`;
  }
}
