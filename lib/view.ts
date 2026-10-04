import { pageRegion, type SourceDef } from "@/collectors/registry";
import type { Region } from "@/collectors/types";
import { DEFAULT_VIEW, VIEWS, type View } from "@/config/ranking";

// The `?region=` query parameter. On the home and topic pages it picks the
// view (Global or US); on a platform page it picks which of the source's
// feeds to show. Anything unknown falls back to the default.

type Param = string | string[] | undefined;

const first = (value: Param) => (Array.isArray(value) ? value[0] : value)?.toLowerCase();

export function parseView(value: Param): View {
  const view = first(value);
  return VIEWS.includes(view as View) ? (view as View) : DEFAULT_VIEW;
}

// "" for the default view, so default links stay clean.
export function viewQuery(view: View): string {
  return view === DEFAULT_VIEW ? "" : `?region=${view}`;
}

export const VIEW_NAMES: Record<View, string> = { global: "Global", us: "United States" };

// What each view is built from, for the line under the toggle.
export const VIEW_NOTES: Record<View, string> = {
  global: "Global: every list, including Google Trends and YouTube for the US, UK, Canada and Australia",
  us: "United States: the US lists plus the worldwide ones (Bluesky, Mastodon, Reddit and others)",
};

export function parseFeed(source: SourceDef, value: Param): Region {
  const feed = first(value);
  return source.regions.includes(feed as Region) ? (feed as Region) : pageRegion(source);
}

export function feedQuery(source: SourceDef, feed: string): string {
  return feed === pageRegion(source) ? "" : `?region=${feed}`;
}
