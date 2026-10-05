import { connection } from "next/server";
import { DEFAULT_VIEW } from "@/config/ranking";
import { getCombinedTop } from "@/lib/cached";
import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";

// The home page's share image: the current top 5 across platforms. It renders
// per request (never at build time) from the same cached data as the page.
export const alt = "The top trending topics across social platforms right now";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  await connection();
  const top = await getCombinedTop(DEFAULT_VIEW);
  return ogImage({
    kicker: "Trending across platforms right now",
    title: "Top 10 Social Trends",
    lines: (top?.entries ?? []).slice(0, 5).map((entry) => ({ marker: String(entry.rank), text: entry.label })),
  });
}
