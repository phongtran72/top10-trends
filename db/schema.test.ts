import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchRuns, rankings, sources, topicItems, topics, trendItems } from "./schema";
import { createTestDb } from "./test-db";

let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

describe("migrations", () => {
  it("create every table with row-level security on", async () => {
    const { rows } = await t.client.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`,
    );
    expect(rows).toEqual(
      ["fetch_runs", "rankings", "sources", "tiktok_curves", "topic_items", "topic_snapshots", "topics", "trend_items"].map((relname) => ({
        relname,
        relrowsecurity: true,
      })),
    );
  });

  it("cascade item deletes to topic_items and per-platform rankings, keeping topics", async () => {
    const now = new Date();
    await t.db.insert(sources).values({ id: "bluesky", name: "Bluesky", role: "lead", weight: 0.5, enabled: true, regions: ["global"] });
    const [run] = await t.db
      .insert(fetchRuns)
      .values({ sourceId: "bluesky", region: "global", startedAt: now, finishedAt: now, status: "ok", itemCount: 1 })
      .returning();
    const [item] = await t.db
      .insert(trendItems)
      .values({ runId: run.id, sourceId: "bluesky", region: "global", rank: 1, title: "Example", url: "https://bsky.app/x", fetchedAt: now })
      .returning();
    const [topic] = await t.db
      .insert(topics)
      .values({ slug: "example", label: "Example", centroid: new Array(384).fill(0), firstSeen: now, lastSeen: now })
      .returning();
    await t.db.insert(topicItems).values({ topicId: topic.id, itemId: item.id });
    await t.db.insert(rankings).values([
      { computedAt: now, list: "bluesky", region: "global", rank: 1, topicId: topic.id, itemId: item.id },
      { computedAt: now, list: "combined", region: "global", rank: 1, topicId: topic.id, score: 0.5 },
    ]);

    await t.db.delete(trendItems);

    expect(await t.db.select().from(topicItems)).toHaveLength(0);
    expect((await t.db.select().from(rankings)).map((r) => r.list)).toEqual(["combined"]);
    expect(await t.db.select().from(topics)).toHaveLength(1);
  });
});
