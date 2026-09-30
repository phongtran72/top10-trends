import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSource, planSources, type SourceId } from "@/collectors/registry";
import type { Region, TrendItem } from "@/collectors/types";
import { rankings, topicItems, topicSnapshots, topics } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { writeResults, type ListResult } from "./collect";
import { platformList } from "@/lib/queries";
import { contextFor, formatRankOutcome, labelFor, rankRun } from "./rank";
import { upsertSources } from "./sources";
import { wordEmbedder } from "./test-embedder";

let t: Awaited<ReturnType<typeof createTestDb>>;
const run1 = new Date("2026-10-08T12:07:00Z");
const run2 = new Date("2026-10-08T13:07:00Z");
const blocklist = new Set(["caturday"]);

function list(sourceId: SourceId, region: Region, at: Date, items: Omit<TrendItem, "source" | "region" | "rank" | "url">[]): ListResult {
  return {
    source: getSource(sourceId),
    region,
    status: "ok",
    items: items.map((item, i) => ({ source: sourceId, region, rank: i + 1, url: `https://example.com/${sourceId}/${i + 1}`, ...item })),
    startedAt: at,
    finishedAt: at,
  };
}

async function runOnce(at: Date, results: ListResult[]) {
  const itemIds = await writeResults(t.db, results);
  return rankRun({ db: t.db, results, itemIds, now: at, embedder: wordEmbedder, blocklist });
}

beforeAll(async () => {
  t = await createTestDb();
  await upsertSources(t.db, planSources({ collectors: new Set(), disabled: [], env: {} }));
});

afterAll(async () => {
  await t.close();
});

describe("rankRun", () => {
  it("filters, merges the same story across platforms and ranks the combined list", async () => {
    const outcome = await runOnce(run1, [
      list("google_trends", "us", run1, [{ title: "world series", matchText: ["dodgers win world series game"] }]),
      list("bluesky", "global", run1, [
        { title: "Test Launch", flags: { status: "cooling" } },
        { title: "#WorldSeries", flags: { status: "trending" } },
        { title: "Election night", flags: { status: "trending" } },
      ]),
      list("youtube", "us", run1, [{ title: "World Series" }, { title: "Cooking with Example" }]),
      list("mastodon", "global", run1, [{ title: "#caturday" }]),
    ]);

    expect(outcome.dropped.map((d) => [d.item.title, d.reason])).toEqual([
      ["Test Launch", "status"],
      ["#caturday", "blocklist"],
    ]);
    expect(outcome.created).toBe(2); // "world series" and "Election night"; the cooking video joins nothing
    expect(outcome.combined.map((c) => [c.label, c.platforms])).toEqual([
      [
        "world series",
        [
          { sourceId: "google_trends", rank: 1 },
          { sourceId: "youtube", rank: 1 },
          { sourceId: "bluesky", rank: 2 },
        ],
      ],
      ["Election night", [{ sourceId: "bluesky", rank: 3 }]],
    ]);
    // 1.0/log2(2) + 0.8/log2(2) + 0.5/log2(3)
    expect(outcome.combined[0].score).toBeCloseTo(2.115);

    const ranked = await t.db.select().from(rankings);
    expect(ranked.filter((r) => r.list === "combined").map((r) => [r.rank, r.score !== null])).toEqual([
      [1, true],
      [2, true],
    ]);
    // Each platform's filtered top 10, renumbered after filters.
    expect(ranked.filter((r) => r.list === "bluesky").map((r) => r.rank)).toEqual([1, 2]);
    expect(ranked.filter((r) => r.list === "youtube").map((r) => [r.rank, r.topicId === null])).toEqual([
      [1, false],
      [2, true],
    ]);
    const saved = await t.db.select().from(topics);
    expect(saved.map((s) => [s.label, s.summary])).toEqual([
      ["world series", "dodgers win world series game"],
      ["Election night", null],
    ]);
    // Permanent snapshots leave YouTube out.
    const snaps = await t.db.select().from(topicSnapshots);
    expect(snaps.map((s) => [s.position, s.platformCount, s.ranks, s.newsCount, s.algoVersion])).toEqual([
      [1, 2, { google_trends: 1, bluesky: 2 }, 1, "all-minilm-l6-v2.q8/t0.80/r1"],
      [2, 1, { bluesky: 3 }, 0, "all-minilm-l6-v2.q8/t0.80/r1"],
    ]);
    expect(formatRankOutcome(outcome)[2]).toBe("   1. world series · 2.12 · google_trends #1, youtube #1, bluesky #2 · new");
  });

  it("joins existing topics an hour later and keeps other sources' fresh lists in the score", async () => {
    const outcome = await runOnce(run2, [list("bluesky", "global", run2, [{ title: "World Series", flags: { status: "trending" } }])]);
    expect(outcome.created).toBe(0);
    expect(await t.db.select().from(topics)).toHaveLength(2);
    expect(await t.db.select().from(topicItems)).toHaveLength(5);
    // Google and YouTube's lists from 12:07 are still fresh; Bluesky's 13:07 list replaces its 12:07 one.
    expect(outcome.combined[0]).toMatchObject({
      label: "world series",
      isNew: false,
      platforms: [
        { sourceId: "google_trends", rank: 1 },
        { sourceId: "youtube", rank: 1 },
        { sourceId: "bluesky", rank: 1 },
      ],
    });
  });
});

describe("Google Trends window", () => {
  const run3 = new Date("2026-10-10T12:07:00Z");
  const run4 = new Date("2026-10-10T13:07:00Z");

  it("ranks Google's lists from the last 3 hours by search volume, for the score and the page", async () => {
    // The feed puts its newest trend first; the bigger one was published earlier.
    await runOnce(run3, [
      list("google_trends", "us", run3, [
        { title: "alpha storm", metricValue: 1000 },
        { title: "beta final", metricValue: 50000 },
      ]),
    ]);
    const first = await t.db.select().from(rankings);
    expect(first.filter((r) => r.list === "google_trends" && r.computedAt.getTime() === run3.getTime()).map((r) => r.rank)).toEqual([1, 2]);

    const outcome = await runOnce(run4, [list("google_trends", "us", run4, [{ title: "gamma launch", metricValue: 2000 }])]);
    // "beta final" left the feed at 13:07 but is still Google's biggest search in the window.
    expect(outcome.combined.map((c) => [c.label, c.platforms])).toEqual([
      ["beta final", [{ sourceId: "google_trends", rank: 1 }]],
      ["gamma launch", [{ sourceId: "google_trends", rank: 2 }]],
      ["alpha storm", [{ sourceId: "google_trends", rank: 3 }]],
    ]);
    const page = await platformList(t.db, getSource("google_trends"));
    expect(page?.items.map((i) => [i.rank, i.title, i.metricValue])).toEqual([
      [1, "beta final", 50000],
      [2, "gamma launch", 2000],
      [3, "alpha storm", 1000],
    ]);
  });
});

describe("labels and context", () => {
  it("names a topic from its item's display form", () => {
    expect(labelFor({ title: "#WorldSeries2026" })).toBe("World Series 2026");
    expect(labelFor({ title: "🎉" })).toBe("🎉");
  });

  it("takes context only from a Google Trends headline", () => {
    expect(contextFor({ sourceId: "google_trends", matchText: ["", "Dodgers win Game 4"] })).toBe("Dodgers win Game 4");
    expect(contextFor({ sourceId: "google_trends" })).toBeNull();
    expect(contextFor({ sourceId: "bluesky", matchText: ["A description"] })).toBeNull();
  });
});
