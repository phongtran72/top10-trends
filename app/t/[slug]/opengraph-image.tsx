import { DEFAULT_VIEW } from "@/config/ranking";
import { getTopicDetail } from "@/lib/cached";
import { REGION_SHORT } from "@/lib/format";
import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";

// A topic's share image: its name, its place across platforms and where it is
// trending. Rendered on demand from the page's cached data.
export const alt = "Where this topic is trending across social platforms";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const detail = await getTopicDetail((await params).slug, DEFAULT_VIEW);
  if (!detail) return ogImage({ kicker: "Topic", title: "Top 10 Social Trends", lines: [] });
  const platforms = detail.platforms.map((p) => `${p.name}${p.feed ? ` ${REGION_SHORT[p.feed] ?? p.feed}` : ""} #${p.rank}`);
  return ogImage({
    kicker: detail.currentRank !== null ? `#${detail.currentRank} across platforms right now` : "Trending topic",
    title: detail.label,
    lines: [...(detail.summary ? [{ text: detail.summary }] : []), ...(platforms.length > 0 ? [{ text: platforms.join(" · ") }] : [])],
  });
}
