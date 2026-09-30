import { COLLECTORS } from "@/collectors/index";
import { pageRegion, PLATFORMS, platformSlug, type SourceDef, type SourceId } from "@/collectors/registry";
import type { ListItem, RecentItem } from "./queries";
import { rankWindow, WINDOWED_SOURCES } from "./window";

// The home-page dashboard, computed from the last day of top-10 lists. Pure,
// so it is tested without a database. Items are matched across runs by their
// normalized title, which is stable for every source.

export interface PlatformCard {
  id: SourceId;
  name: string;
  slug: string;
  region: string;
  fetchedAt: string | null;
  top: ListItem[];
}

export interface DashboardEntry {
  sourceId: SourceId;
  name: string;
  slug: string;
  title: string;
  url: string;
  rank: number;
}

export interface Mover extends DashboardEntry {
  previousRank: number;
}

export interface Staying extends Omit<DashboardEntry, "rank"> {
  rank: number | null; // current rank, or null if it has dropped out
  lists: number; // lists in the window that had it in the top 10
  of: number; // lists in the window
}

export interface Highlight extends DashboardEntry {
  label: string;
  metricValue: number;
  metricLabel: string | null;
}

export interface Dashboard {
  updatedAt: string | null;
  platforms: PlatformCard[];
  highlights: Highlight[];
  newEntries: DashboardEntry[];
  movers: Mover[];
  staying: Staying[];
}

export const DASHBOARD_WINDOW_HOURS = 25;
const STAYING_HOURS = 24;

const HIGHLIGHT_LABELS: Partial<Record<SourceId, string>> = {
  google_trends: "Top search",
  youtube: "Most-viewed video",
  bluesky: "Most-posted topic",
  hacker_news: "Most-upvoted story",
  mastodon: "Most-used tag",
  x: "Most-posted X trend",
  tiktok: "Most-viewed TikTok hashtag",
};

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

interface Run {
  fetchedAt: string;
  items: RecentItem[];
}

// Runs of one source and region, newest first.
function runsFor(rows: readonly RecentItem[], source: SourceDef): Run[] {
  const region = pageRegion(source);
  const byRun = new Map<number, Run>();
  for (const row of rows) {
    if (row.sourceId !== source.id || row.region !== region) continue;
    const run = byRun.get(row.runId) ?? { fetchedAt: row.fetchedAt, items: [] };
    run.items.push(row);
    byRun.set(row.runId, run);
  }
  for (const run of byRun.values()) run.items.sort((a, b) => a.rank - b.rank);
  const runs = [...byRun.values()].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
  const hours = WINDOWED_SOURCES.get(source.id);
  return hours === undefined ? runs : runs.map((run) => windowRun(run, runs, hours));
}

// A windowed source (Google Trends) as of one run: every item from the runs in
// the window before it, ranked by search volume.
function windowRun(run: Run, runs: readonly Run[], hours: number): Run {
  const end = Date.parse(run.fetchedAt);
  const start = end - hours * 60 * 60 * 1000;
  const inWindow = runs.filter((r) => Date.parse(r.fetchedAt) > start && Date.parse(r.fetchedAt) <= end).flatMap((r) => r.items);
  return { fetchedAt: run.fetchedAt, items: rankWindow(inWindow).slice(0, 10).map((item, index) => ({ ...item, rank: index + 1 })) };
}

const toListItem = ({ rank, title, url, metricValue, metricLabel }: RecentItem): ListItem => ({
  rank,
  title,
  url,
  metricValue,
  metricLabel,
});

export function buildDashboard(
  rows: readonly RecentItem[],
  now: Date,
  platforms: readonly SourceDef[] = PLATFORMS.filter((p) => COLLECTORS.has(p.id)),
): Dashboard {
  const stayingSince = new Date(now.getTime() - STAYING_HOURS * 60 * 60 * 1000).toISOString();
  const cards: PlatformCard[] = [];
  const highlights: Highlight[] = [];
  const newEntries: DashboardEntry[] = [];
  const movers: Mover[] = [];
  const staying: Staying[] = [];

  for (const source of platforms) {
    const runs = runsFor(rows, source);
    const [latest, previous] = runs;
    const base = { sourceId: source.id, name: source.name, slug: platformSlug(source.id) };
    cards.push({
      id: source.id,
      name: source.name,
      slug: base.slug,
      region: pageRegion(source),
      fetchedAt: latest?.fetchedAt ?? null,
      top: (latest?.items ?? []).slice(0, 3).map(toListItem),
    });
    if (!latest) continue;

    // Highlight: the biggest number in the current list.
    const label = HIGHLIGHT_LABELS[source.id];
    const biggest = latest.items
      .filter((item) => item.metricValue !== null)
      .sort((a, b) => b.metricValue! - a.metricValue! || a.rank - b.rank)[0];
    if (label && biggest) {
      highlights.push({
        ...base,
        label,
        title: biggest.title,
        url: biggest.url,
        rank: biggest.rank,
        metricValue: biggest.metricValue!,
        metricLabel: biggest.metricLabel,
      });
    }

    // New entries and climbers, against the previous list.
    if (previous) {
      const previousRanks = new Map(previous.items.map((item) => [normalizeTitle(item.title), item.rank]));
      for (const item of latest.items) {
        const before = previousRanks.get(normalizeTitle(item.title));
        const entry = { ...base, title: item.title, url: item.url, rank: item.rank };
        if (before === undefined) newEntries.push(entry);
        else if (before > item.rank) movers.push({ ...entry, previousRank: before });
      }
    }

    // Staying power: how many of the last day's lists had each item.
    const window = runs.filter((run) => run.fetchedAt > stayingSince);
    if (window.length >= 2) {
      const seen = new Map<string, { count: number; item: RecentItem }>();
      for (const run of window) {
        for (const item of run.items) {
          const key = normalizeTitle(item.title);
          const entry = seen.get(key);
          if (entry) entry.count += 1;
          else seen.set(key, { count: 1, item }); // runs are newest first, so this is the latest sighting
        }
      }
      const current = new Map(latest.items.map((item) => [normalizeTitle(item.title), item.rank]));
      for (const [key, { count, item }] of seen) {
        if (count < 2) continue;
        staying.push({ ...base, title: item.title, url: item.url, rank: current.get(key) ?? null, lists: count, of: window.length });
      }
    }
  }

  const order = new Map(platforms.map((p, i) => [p.id, i]));
  const byPlatform = (a: { sourceId: SourceId }, b: { sourceId: SourceId }) =>
    order.get(a.sourceId)! - order.get(b.sourceId)!;
  const latestFetch = cards.map((c) => c.fetchedAt).filter((t): t is string => t !== null).sort().at(-1) ?? null;

  return {
    updatedAt: latestFetch,
    platforms: cards,
    highlights,
    newEntries: newEntries.sort((a, b) => a.rank - b.rank || byPlatform(a, b)).slice(0, 8),
    movers: movers
      .sort((a, b) => b.previousRank - b.rank - (a.previousRank - a.rank) || a.rank - b.rank || byPlatform(a, b))
      .slice(0, 6),
    staying: staying
      .sort(
        (a, b) =>
          b.lists / b.of - a.lists / a.of ||
          (a.rank ?? 99) - (b.rank ?? 99) ||
          byPlatform(a, b),
      )
      .slice(0, 6),
  };
}
