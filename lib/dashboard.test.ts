import { describe, expect, it } from "vitest";
import { getSource } from "@/collectors/registry";
import { buildDashboard, itemKey, normalizeTitle } from "./dashboard";
import type { RecentItem } from "./queries";

const now = new Date("2026-09-30T12:10:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

let runId = 0;
function run(sourceId: string, region: string, at: string, titles: string[], metrics: (number | null)[] = [], urls: (string | undefined)[] = []): RecentItem[] {
  runId += 1;
  return titles.map((title, i) => ({
    runId,
    sourceId,
    region,
    fetchedAt: at,
    rank: i + 1,
    title,
    url: urls[i] ?? `https://example.com/${encodeURIComponent(normalizeTitle(title))}`,
    metricValue: metrics[i] ?? null,
    metricLabel: metrics[i] === undefined || metrics[i] === null ? null : "posts",
  }));
}

const bluesky = getSource("bluesky");
const twitch = getSource("twitch");
const youtube = getSource("youtube");

describe("buildDashboard", () => {
  const rows = [
    ...run("bluesky", "global", hoursAgo(26), ["Ancient"]), // outside every window
    ...run("bluesky", "global", hoursAgo(3), ["Alpha", "Beta", "Gamma", "Delta"], [10, 20, 5, 1]),
    ...run("bluesky", "global", hoursAgo(2), ["Beta", "Alpha", "Gamma", "Delta"], [30, 10, 5, 1]),
    ...run("bluesky", "global", hoursAgo(1), ["gamma ", "Beta", "Epsilon", "Alpha"], [50, 40, 30, 5]),
    ...run("twitch", "global", hoursAgo(1), ["Example Quest", "Sample Kart"]),
  ];
  const dashboard = buildDashboard(rows, now, [bluesky, twitch, youtube]);

  it("shows each platform's top 3 and when it was fetched", () => {
    expect(dashboard.updatedAt).toBe(hoursAgo(1));
    expect(dashboard.platforms.map((p) => [p.id, p.slug, p.fetchedAt, p.top.map((i) => i.title)])).toEqual([
      ["bluesky", "bluesky", hoursAgo(1), ["gamma ", "Beta", "Epsilon"]],
      ["twitch", "twitch", hoursAgo(1), ["Example Quest", "Sample Kart"]],
      ["youtube", "youtube", null, []],
    ]);
  });

  it("finds new entries and climbers against the previous list", () => {
    expect(dashboard.newEntries.map((e) => [e.sourceId, e.rank, e.title])).toEqual([["bluesky", 3, "Epsilon"]]);
    expect(dashboard.movers.map((m) => [m.title, m.previousRank, m.rank])).toEqual([["gamma ", 3, 1]]);
  });

  it("measures staying power over the last day's lists, matching titles loosely", () => {
    // Three lists in the last 24 hours; "Ancient" is older. Ties break by current rank.
    expect(dashboard.staying.map((s) => [s.title, s.lists, s.of, s.rank])).toEqual([
      ["gamma ", 3, 3, 1],
      ["Beta", 3, 3, 2],
      ["Alpha", 3, 3, 4],
      ["Delta", 2, 3, null],
    ]);
  });

  it("highlights the biggest number in each current list", () => {
    expect(dashboard.highlights).toEqual([
      expect.objectContaining({ sourceId: "bluesky", label: "Most-posted topic", title: "gamma ", metricValue: 50 }),
    ]);
  });

  it("needs two lists before it reports changes", () => {
    const single = buildDashboard(run("bluesky", "global", hoursAgo(1), ["Only"]), now, [bluesky]);
    expect(single.newEntries).toEqual([]);
    expect(single.movers).toEqual([]);
    expect(single.staying).toEqual([]);
  });
});

describe("Google Trends in the dashboard", () => {
  const google = getSource("google_trends");
  // The feed lists the newest trends first; its 3-hour window is ranked by search volume.
  const rows = [
    ...run("google_trends", "us", hoursAgo(4), ["too old"], [900000]),
    ...run("google_trends", "us", hoursAgo(2), ["astros", "berkeley fire"], [50000, 1000]),
    ...run("google_trends", "us", hoursAgo(1), ["alex eala", "rihanna"], [5000, 2000]),
  ];
  const dashboard = buildDashboard(rows, now, [google]);

  it("shows the window's biggest searches, not the newest", () => {
    expect(dashboard.platforms[0].top.map((i) => [i.rank, i.title])).toEqual([
      [1, "astros"],
      [2, "alex eala"],
      [3, "rihanna"],
    ]);
    expect(dashboard.highlights[0]).toMatchObject({ label: "Top search", title: "astros", metricValue: 50000 });
  });

  it("compares windows, so an older big search is not a new entry", () => {
    expect(dashboard.newEntries.map((e) => [e.rank, e.title])).toEqual([
      [2, "alex eala"],
      [3, "rihanna"],
    ]);
    // An hour earlier the window still held the 4-hour-old list, so "astros" was #2.
    expect(dashboard.movers.map((m) => [m.title, m.previousRank, m.rank])).toEqual([["astros", 2, 1]]);
  });
});

describe("new entries", () => {
  it("doesn't call a topic new when it was in a list of the previous two hours", () => {
    const rows = [
      ...run("bluesky", "global", hoursAgo(4), ["Old story"]),
      ...run("bluesky", "global", hoursAgo(2), ["Flicker", "Steady"]),
      ...run("bluesky", "global", hoursAgo(1), ["Steady"]),
      ...run("bluesky", "global", hoursAgo(0), ["Steady", "Flicker", "Old story", "Fresh"]),
    ];
    const dashboard = buildDashboard(rows, now, [bluesky]);
    // "Flicker" skipped one hour; "Old story" was last seen 4 hours ago, so it counts as new again.
    expect(dashboard.newEntries.map((e) => e.title)).toEqual(["Old story", "Fresh"]);
    expect(dashboard.movers).toEqual([]);
  });
});

describe("Bluesky renames", () => {
  it("follows a renamed Bluesky topic by its link", () => {
    const link = "https://bsky.app/profile/trending.bsky.app/feed/example";
    const rows = [
      ...run("bluesky", "global", hoursAgo(2), ["Senate hearing", "Example testifies to Senate"], [], [undefined, link]),
      ...run("bluesky", "global", hoursAgo(1), ["Sample remarks on Example", "Senate hearing"], [], [link, undefined]),
    ];
    const dashboard = buildDashboard(rows, now, [bluesky]);
    expect(dashboard.newEntries).toEqual([]);
    expect(dashboard.movers.map((m) => [m.title, m.previousRank, m.rank])).toEqual([["Sample remarks on Example", 2, 1]]);
    expect(dashboard.staying.map((s) => [s.title, s.lists])).toEqual([
      ["Sample remarks on Example", 2],
      ["Senate hearing", 2],
    ]);
  });

  it("keys other sources by normalized title", () => {
    expect(itemKey({ sourceId: "x", title: " World  Series", url: "https://x.com/a" })).toBe("world series");
    expect(itemKey({ sourceId: "bluesky", title: "World Series", url: "https://bsky.app/a" })).toBe("https://bsky.app/a");
  });
});

describe("normalizeTitle", () => {
  it("ignores case and extra spaces", () => {
    expect(normalizeTitle("  World   Series ")).toBe("world series");
  });
});
