import { WEIGHTS } from "@/config/ranking";
import { readKeys, type RawEnv } from "@/lib/env";
import type { Region } from "./types";

export type SourceId = keyof typeof WEIGHTS | "heartbeat";
export type SourceRole = "lead" | "corroborating" | "system";

export interface SourceDef {
  id: SourceId;
  name: string;
  role: SourceRole;
  weight: number;
  regions: readonly Region[];
  // Keys the source needs; when any is missing the source is skipped.
  env: readonly string[];
  // A variable that must be "true" to turn the source on (the Apify sources).
  optIn?: string;
  phase: 0 | 1 | 2 | 3;
  homepage?: string;
}

// Every source, in the order the site lists them. `heartbeat` is the
// pipeline's own row that proves a run happened.
export const SOURCES: readonly SourceDef[] = [
  { id: "x", name: "X", role: "lead", weight: WEIGHTS.x, regions: ["global", "us"], env: ["X_BEARER_TOKEN"], phase: 3, homepage: "https://x.com/explore" },
  { id: "google_trends", name: "Google Trends", role: "lead", weight: WEIGHTS.google_trends, regions: ["us"], env: [], phase: 1, homepage: "https://trends.google.com/trending" },
  { id: "bluesky", name: "Bluesky", role: "lead", weight: WEIGHTS.bluesky, regions: ["global"], env: [], phase: 1, homepage: "https://bsky.app" },
  { id: "mastodon", name: "Mastodon", role: "lead", weight: WEIGHTS.mastodon, regions: ["global"], env: [], phase: 1, homepage: "https://mastodon.social/explore/tags" },
  { id: "youtube", name: "YouTube", role: "corroborating", weight: WEIGHTS.youtube, regions: ["us"], env: ["YOUTUBE_API_KEY"], phase: 1, homepage: "https://www.youtube.com" },
  { id: "reddit", name: "Reddit", role: "corroborating", weight: WEIGHTS.reddit, regions: ["global"], env: [], phase: 3, homepage: "https://www.reddit.com/r/popular/" },
  { id: "tiktok", name: "TikTok", role: "corroborating", weight: WEIGHTS.tiktok, regions: ["us"], env: ["APIFY_TOKEN"], optIn: "TIKTOK_ENABLED", phase: 3, homepage: "https://www.tiktok.com" },
  { id: "instagram", name: "Instagram", role: "corroborating", weight: WEIGHTS.instagram, regions: ["global"], env: ["APIFY_TOKEN"], optIn: "INSTAGRAM_ENABLED", phase: 3, homepage: "https://www.instagram.com/explore/" },
  { id: "twitch", name: "Twitch", role: "corroborating", weight: WEIGHTS.twitch, regions: ["global"], env: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"], phase: 1, homepage: "https://www.twitch.tv/directory" },
  { id: "hacker_news", name: "Hacker News", role: "corroborating", weight: WEIGHTS.hacker_news, regions: ["global"], env: [], phase: 1, homepage: "https://news.ycombinator.com" },
  { id: "pinterest", name: "Pinterest", role: "corroborating", weight: WEIGHTS.pinterest, regions: ["us"], env: ["APIFY_TOKEN"], optIn: "PINTEREST_ENABLED", phase: 3, homepage: "https://www.pinterest.com/today/" },
  { id: "heartbeat", name: "Heartbeat", role: "system", weight: 0, regions: ["global"], env: [], phase: 0 },
];

export const PLATFORMS = SOURCES.filter((source) => source.role !== "system");

// URL slug for /p/[platform]: google_trends → google-trends.
export function platformSlug(id: SourceId): string {
  return id.replace(/_/g, "-");
}

export function platformBySlug(slug: string): SourceDef | undefined {
  return PLATFORMS.find((source) => platformSlug(source.id) === slug);
}

// The feed a platform page shows: the global one, or the US one when a source
// has no global feed (PLAN.md › Ranking › Regions).
export function pageRegion(source: SourceDef): Region {
  return source.regions.includes("global") ? "global" : source.regions[0];
}

export function getSource(id: SourceId): SourceDef {
  const source = SOURCES.find((s) => s.id === id);
  if (!source) throw new Error(`unknown source: ${id}`);
  return source;
}

// What a run does with a source:
// - run: fetch it.
// - skip: write a `skipped` fetch_runs row with the reason (disabled or missing keys).
// - absent: its collector isn't built yet, so write nothing.
export type SourcePlan =
  | { source: SourceDef; action: "run" }
  | { source: SourceDef; action: "skip"; reason: string }
  | { source: SourceDef; action: "absent"; reason: string };

// A platform runs when its collector exists, its keys are present and its id
// isn't in DISABLED_SOURCES. The heartbeat always runs.
export function planSources(options: {
  collectors: ReadonlySet<SourceId>;
  disabled: readonly string[];
  env?: RawEnv;
}): SourcePlan[] {
  const disabled = new Set(options.disabled);
  return SOURCES.map((source): SourcePlan => {
    if (source.role === "system") return { source, action: "run" };
    if (!options.collectors.has(source.id)) {
      return { source, action: "absent", reason: `collector not built yet (phase ${source.phase})` };
    }
    if (disabled.has(source.id)) return { source, action: "skip", reason: "disabled by DISABLED_SOURCES" };
    const { missing } = readKeys(source.env, options.env);
    if (missing.length > 0) return { source, action: "skip", reason: `missing ${missing.join(", ")}` };
    if (source.optIn && readKeys([source.optIn], options.env).values[source.optIn]?.toLowerCase() !== "true") {
      return { source, action: "skip", reason: `${source.optIn} is not true` };
    }
    return { source, action: "run" };
  });
}

// Ids in DISABLED_SOURCES that match no source, so a typo is visible.
export function unknownSourceIds(ids: readonly string[]): string[] {
  const known = new Set<string>(SOURCES.map((s) => s.id));
  return ids.filter((id) => !known.has(id));
}
