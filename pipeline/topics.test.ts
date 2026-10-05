import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc } from "drizzle-orm";
import { planSources } from "@/collectors/registry";
import { fetchRuns, topicItems, topics, trendItems } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { unitVector } from "@/lib/embed";
import type { MatchResult, Topic } from "./match";
import { upsertSources } from "./sources";
import { loadRecentTopics, saveMatches } from "./topics";

let t: Awaited<ReturnType<typeof createTestDb>>;
const now = new Date("2026-10-08T12:07:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const vector = (x: number, y: number) => [...unitVector([x, y]), ...new Array(382).fill(0)];
let itemIds: number[] = [];

beforeAll(async () => {
  t = await createTestDb();
  await upsertSources(t.db, planSources({ collectors: new Set(), disabled: [], env: {} }));
  const [run] = await t.db
    .insert(fetchRuns)
    .values({ sourceId: "bluesky", region: "global", startedAt: now, finishedAt: now, status: "ok", itemCount: 3 })
    .returning();
  const rows = await t.db
    .insert(trendItems)
    .values([1, 2, 3].map((rank) => ({ runId: run.id, sourceId: "bluesky", region: "global", rank, title: `t${rank}`, url: "https://bsky.app", fetchedAt: now })))
    .returning({ id: trendItems.id });
  itemIds = rows.map((r) => r.id);
  await t.db.insert(topics).values([
    { slug: "recent-20261008", label: "Recent", centroid: vector(1, 0), firstSeen: hoursAgo(5), lastSeen: hoursAgo(1) },
    { slug: "old-20261005", label: "Old", centroid: vector(0, 1), firstSeen: hoursAgo(80), lastSeen: hoursAgo(49) },
  ]);
});

afterAll(async () => {
  await t.close();
});

describe("loadRecentTopics", () => {
  it("loads topics seen in the last 48 hours with their item counts", async () => {
    const loaded = await loadRecentTopics(t.db, now);
    expect(loaded.map((l) => [l.label, l.count, l.isNew, l.changed])).toEqual([["Recent", 1, false, false]]);
    expect(loaded[0].centroid).toHaveLength(384);
  });

  it("loads the names of each topic's members from the window, for matching by name", async () => {
    const [recent] = await loadRecentTopics(t.db, now);
    const [run] = await t.db
      .insert(fetchRuns)
      .values({ sourceId: "x", region: "us", startedAt: hoursAgo(2), finishedAt: hoursAgo(2), status: "ok", itemCount: 2 })
      .returning();
    const rows = await t.db
      .insert(trendItems)
      .values([
        { runId: run.id, sourceId: "x", region: "us", rank: 1, title: "#BahrainGP", url: "https://x.com", fetchedAt: hoursAgo(2) },
        { runId: run.id, sourceId: "x", region: "us", rank: 2, title: "Old name", url: "https://x.com", fetchedAt: hoursAgo(60) },
      ])
      .returning({ id: trendItems.id });
    await t.db.insert(topicItems).values(rows.map((row) => ({ topicId: recent.id!, itemId: row.id })));
    const [loaded] = await loadRecentTopics(t.db, now);
    expect([...(loaded.names ?? [])]).toEqual(["bahraingp"]); // the 60-hour-old member is outside the window
    await t.db.delete(topicItems);
  });
});

describe("saveMatches", () => {
  it("inserts new topics with unique slugs, updates changed ones and links items", async () => {
    const [recent] = await loadRecentTopics(t.db, now);
    const fresh = (label: string): Topic => ({
      id: null,
      label,
      summary: "A headline",
      centroid: vector(0, 1),
      count: 1,
      firstSeen: now,
      lastSeen: now,
      isNew: true,
      changed: true,
    });
    const first = fresh("World Series");
    const second = fresh("World Series"); // same label, same day
    const updated = { ...recent, lastSeen: now, changed: true, summary: "Now with context" };
    const result: MatchResult = {
      topics: [updated, first, second],
      assignments: new Map<number, Topic>([
        [itemIds[0], updated],
        [itemIds[1], first],
        [itemIds[2], second],
      ]),
      similarities: new Map(),
    };

    await expect(saveMatches(t.db, result)).resolves.toEqual({ created: 2, updated: 1, linked: 3 });

    const rows = await t.db.select().from(topics).orderBy(asc(topics.id));
    expect(rows.map((r) => [r.slug, r.summary])).toEqual([
      ["recent-20261008", "Now with context"],
      ["old-20261005", null],
      ["world-series-20261008", "A headline"],
      ["world-series-20261008-2", "A headline"],
    ]);
    expect(rows[0].lastSeen).toEqual(now);
    const links = await t.db.select().from(topicItems);
    expect(links).toHaveLength(3);

    // Saving the same links again is harmless.
    await saveMatches(t.db, { ...result, topics: [] });
    expect(await t.db.select().from(topicItems)).toHaveLength(3);
  });
});
