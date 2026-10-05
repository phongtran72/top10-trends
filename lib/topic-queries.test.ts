import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSource, planSources, type SourceId } from "@/collectors/registry";
import type { Region, TrendItem } from "@/collectors/types";
import { topics } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { writeResults, type ListResult } from "@/pipeline/collect";
import { rankRun } from "@/pipeline/rank";
import { upsertSources } from "@/pipeline/sources";
import { WORD_EMBEDDER_THRESHOLD, wordEmbedder } from "@/pipeline/test-embedder";
import { platformList } from "./queries";
import { combinedTop, recentTopTopics, topicDetail } from "./topic-queries";

let t: Awaited<ReturnType<typeof createTestDb>>;
const t0 = new Date("2026-10-07T12:07:00Z");
const t1 = new Date("2026-10-08T12:07:00Z");

function list(sourceId: SourceId, region: Region, at: Date, titles: (string | Partial<TrendItem>)[]): ListResult {
  return {
    source: getSource(sourceId),
    region,
    status: "ok",
    items: titles.map((entry, i) => ({
      source: sourceId,
      region,
      rank: i + 1,
      url: `https://example.com/${sourceId}/${at.getTime()}/${i + 1}`,
      title: typeof entry === "string" ? entry : entry.title!,
      ...(typeof entry === "string" ? {} : entry),
    })),
    startedAt: at,
    finishedAt: at,
  };
}

async function run(at: Date, results: ListResult[]) {
  const itemIds = await writeResults(t.db, results);
  await rankRun({ db: t.db, results, itemIds, now: at, embedder: wordEmbedder, blocklist: new Set(["caturday"]), threshold: WORD_EMBEDDER_THRESHOLD });
}

beforeAll(async () => {
  t = await createTestDb();
  await upsertSources(t.db, planSources({ collectors: new Set(), disabled: [], env: {} }));
  await run(t0, [
    list("google_trends", "us", t0, ["flood watch", { title: "world series", matchText: ["Dodgers win the world series"] }]),
    list("bluesky", "global", t0, ["Election night"]),
  ]);
  await run(t1, [
    list("google_trends", "us", t1, [{ title: "world series", matchText: ["Dodgers win the world series"] }, "flood watch"]),
    list("youtube", "us", t1, ["World Series"]),
    list("bluesky", "global", t1, ["New topic", "#caturday"]),
  ]);
});

afterAll(async () => {
  await t.close();
});

describe("combinedTop", () => {
  it("returns the newest combined top 10 with platforms and change against a day earlier", async () => {
    const top = await combinedTop(t.db);
    expect(top?.computedAt).toBe(t1.toISOString());
    expect(top?.compared).toBe(true);
    expect(
      top?.entries.map((e) => [e.rank, e.label, e.summary, e.change, e.platforms.map((p) => `${p.slug} #${p.rank}`)]),
    ).toEqual([
      [1, "world series", "Dodgers win the world series", 1, ["google-trends #1", "youtube #1"]],
      [2, "flood watch", null, -1, ["google-trends #2"]],
      [3, "New topic", null, null, ["bluesky #1"]],
    ]);
    expect(top?.entries[0].score).toBeCloseTo(1.8);
    expect(top?.entries[0].slug).toBe("world-series-20261007");
  });
});

describe("Claude's names", () => {
  it("are shown in place of the label and the headline when a topic has them", async () => {
    await t.db.update(topics).set({ name: "World Series", reason: "The Dodgers won the series." }).where(eq(topics.slug, "world-series-20261007"));
    const top = await combinedTop(t.db);
    expect(top?.entries.map((e) => [e.label, e.summary])).toEqual([
      ["World Series", "The Dodgers won the series."],
      ["flood watch", null],
      ["New topic", null],
    ]);
    expect(await topicDetail(t.db, "world-series-20261007")).toMatchObject({ label: "World Series", summary: "The Dodgers won the series." });
    await t.db.update(topics).set({ name: null, reason: null }).where(eq(topics.slug, "world-series-20261007"));
  });
});

describe("recentTopTopics", () => {
  it("lists the topics that were in a combined top 10 since a time, newest first, for the sitemap", async () => {
    const all = await recentTopTopics(t.db, new Date("2026-10-01T00:00:00Z"));
    expect(all.map((topic) => topic.slug).sort()).toEqual(["election-night-20261007", "flood-watch-20261007", "new-topic-20261008", "world-series-20261007"]);
    expect(all[0].lastRankedAt).toBe(t1.toISOString());
    // "Election night" was last ranked a day earlier.
    expect((await recentTopTopics(t.db, new Date("2026-10-08T00:00:00Z"))).map((topic) => topic.slug)).not.toContain("election-night-20261007");
  });
});

describe("topicDetail", () => {
  it("shows where a topic stands, its 7-day history and its links", async () => {
    const detail = await topicDetail(t.db, "world-series-20261007");
    expect(detail).toMatchObject({
      label: "world series",
      summary: "Dodgers win the world series",
      currentRank: 1,
      history: [
        { at: t0.toISOString(), rank: 2 },
        { at: t1.toISOString(), rank: 1 },
      ],
    });
    expect(detail?.platforms.map((p) => [p.sourceId, p.rank])).toEqual([
      ["google_trends", 1],
      ["youtube", 1],
    ]);
    expect(detail?.links.map((l) => [l.sourceId, l.items.map((i) => i.rank)])).toEqual([
      ["google_trends", [1, 2]],
      ["youtube", [1]],
    ]);
  });

  it("returns null for an unknown slug", async () => {
    expect(await topicDetail(t.db, "nope")).toBeNull();
  });
});

describe("platformList after ranking", () => {
  it("shows the filtered, renumbered list", async () => {
    const bluesky = await platformList(t.db, getSource("bluesky"));
    expect(bluesky?.items.map((i) => [i.rank, i.title])).toEqual([[1, "New topic"]]);
  });
});

describe("views", () => {
  it("gives each view its own top 10, and names the feed in a badge when it isn't the page's first", async () => {
    const db = await createTestDb();
    try {
      await upsertSources(db.db, planSources({ collectors: new Set(), disabled: [], env: {} }));
      const now = new Date("2026-10-10T12:07:00Z");
      const results = [
        list("google_trends", "us", now, ["budget vote", "tower strike"]),
        list("google_trends", "gb", now, ["tower strike", "harbor fire"]),
      ];
      const itemIds = await writeResults(db.db, results);
      await rankRun({ db: db.db, results, itemIds, now, embedder: wordEmbedder, blocklist: new Set(), threshold: WORD_EMBEDDER_THRESHOLD });

      const badges = async (view: "global" | "us") =>
        (await combinedTop(db.db, view))!.entries.map((e) => [e.rank, e.label, e.platforms.map((p) => [p.sourceId, p.rank, p.feed ?? null])]);
      expect(await badges("us")).toEqual([
        [1, "budget vote", [["google_trends", 1, null]]],
        [2, "tower strike", [["google_trends", 2, null]]],
      ]);
      // Global: the UK feed ranks "tower strike" higher than the US feed does, and only it has "harbor fire".
      expect(await badges("global")).toEqual([
        [1, "budget vote", [["google_trends", 1, null]]],
        [2, "tower strike", [["google_trends", 1, "gb"]]],
        [3, "harbor fire", [["google_trends", 2, "gb"]]],
      ]);

      const slug = (await combinedTop(db.db, "global"))!.entries[2].slug;
      expect((await topicDetail(db.db, slug, "global"))?.currentRank).toBe(3);
      const inUs = await topicDetail(db.db, slug, "us");
      expect(inUs?.currentRank).toBeNull();
      expect(inUs?.platforms).toEqual([]);
      expect(inUs?.history).toEqual([]);
    } finally {
      await db.close();
    }
  });
});

describe("badges for platforms counted from outside a page's top 10", () => {
  it("marks a Bluesky topic in its grace hours and shows a rank past 10", async () => {
    const db = await createTestDb();
    try {
      await upsertSources(db.db, planSources({ collectors: new Set(), disabled: [], env: {} }));
      const earlier = new Date("2026-10-09T11:07:00Z");
      const now = new Date("2026-10-09T12:07:00Z");
      const rank = (at: Date, results: ListResult[]) =>
        writeResults(db.db, results).then((itemIds) =>
          rankRun({ db: db.db, results, itemIds, now: at, embedder: wordEmbedder, blocklist: new Set(), threshold: WORD_EMBEDDER_THRESHOLD }),
        );
      await rank(earlier, [list("bluesky", "global", earlier, ["Storm warning", "Harbor fire"])]);
      const fillers = ["red apple", "blue river", "green forest", "quiet mountain", "silver bridge", "golden bell", "winter garden", "summer market", "morning train", "evening concert", "paper lantern"];
      await rank(now, [
        list("bluesky", "global", now, ["Harbor fire"]),
        list("mastodon", "global", now, [...fillers, "harbor fire"]),
        // X's Worldwide list has it at #1 and its US list at #3: the US rank is X's rank.
        list("x", "global", now, ["Harbor fire"]),
        list("x", "us", now, ["quiet mountain", "silver bridge", "Harbor fire"]),
      ]);

      const top = await combinedTop(db.db);
      const badges = Object.fromEntries(
        top!.entries.map((e) => [e.label, e.platforms.map((p) => [p.sourceId, p.rank, p.seenAt ?? null])]),
      );
      expect(badges["Harbor fire"]).toEqual([
        ["bluesky", 1, null],
        ["x", 3, null],
        ["mastodon", 12, null],
      ]);
      expect(badges["Storm warning"]).toEqual([["bluesky", 1, earlier.toISOString()]]);

      const detail = await topicDetail(db.db, top!.entries.find((e) => e.label === "Storm warning")!.slug);
      expect(detail?.platforms.map((p) => [p.sourceId, p.seenAt])).toEqual([["bluesky", earlier.toISOString()]]);
    } finally {
      await db.close();
    }
  });
});
