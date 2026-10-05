// The site's public origin, for absolute links in metadata, share images, the
// sitemap and robots.txt. SITE_URL wins when set; on Vercel the production
// domain comes from a system variable; locally it is the dev server.
export function siteUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const explicit = env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

export const SITE_NAME = "Top 10 Social Trends";
export const SITE_DESCRIPTION = "The top 10 trending topics on each social platform, plus one combined list, refreshed every hour.";
