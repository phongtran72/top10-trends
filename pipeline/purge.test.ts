import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planSources } from "@/collectors/registry";
import { fetchRuns, rankings, topics, trendItems } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { purge } from "./purge";
import { upsertSources } from "./sources";

let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
  await upsertSources(t.db, planSources({ collectors: new Set(), disabled: [], env: {} }));
});

afterAll(async () => {
  await t.close();
});

const now = new Date("2026-09-30T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

async function addRun(startedAt: Date, withItem: boolean) {
  const [run] = await t.db
    .insert(fetchRuns)
    .values({ sourceId: "bluesky", region: "global", startedAt, finishedAt: startedAt, status: "ok", itemCount: withItem ? 1 : 0 })
    .returning();
  if (withItem) {
    await t.db.insert(trendItems).values({
      runId: run.id,
      sourceId: "bluesky",
      region: "global",
      rank: 1,
      title: "Example",
      url: "https://bsky.app/x",
      fetchedAt: startedAt,
    });
  }
  return run.id;
}

describe("purge", () => {
  it("deletes items older than 28 days and runs older than 90 days", async () => {
    await addRun(daysAgo(100), false); // run past 90 days (its items went long ago)
    await addRun(daysAgo(29), true); // item past 28 days, run kept
    await addRun(daysAgo(27), true); // both kept
    await addRun(daysAgo(0), true); // both kept

    await expect(purge(t.db, now)).resolves.toEqual({ items: 1, runs: 1, rankings: 0, centroids: 0 });

    const items = await t.db.select().from(trendItems);
    expect(items.map((i) => i.fetchedAt.getTime()).sort()).toEqual([daysAgo(27).getTime(), daysAgo(0).getTime()]);
    expect(await t.db.select().from(fetchRuns)).toHaveLength(3);
    await expect(purge(t.db, now)).resolves.toEqual({ items: 0, runs: 0, rankings: 0, centroids: 0 });
  });

  it("clears the centroid of a topic not seen for 7 days, and keeps the topic", async () => {
    const centroid = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
    const topic = (slug: string, lastSeen: Date, withCentroid = true) => ({
      slug,
      label: slug,
      centroid: withCentroid ? centroid : null,
      firstSeen: daysAgo(20),
      lastSeen,
    });
    await t.db.insert(topics).values([
      topic("unseen-8-days", daysAgo(8)),
      topic("seen-6-days-ago", daysAgo(6)),
      topic("cleared-before", daysAgo(9), false),
    ]);

    await expect(purge(t.db, now)).resolves.toEqual({ items: 0, runs: 0, rankings: 0, centroids: 1 });

    const rows = await t.db.select({ slug: topics.slug, centroid: topics.centroid }).from(topics);
    expect(Object.fromEntries(rows.map((row) => [row.slug, row.centroid === null ? null : row.centroid.length]))).toEqual({
      "unseen-8-days": null,
      "seen-6-days-ago": 384,
      "cleared-before": null,
    });
    await expect(purge(t.db, now)).resolves.toEqual({ items: 0, runs: 0, rankings: 0, centroids: 0 });
  });

  it("keeps per-platform rankings 2 days and combined rankings 7 days", async () => {
    const itemId = (await t.db.select({ id: trendItems.id }).from(trendItems).limit(1))[0].id;
    const ranking = (list: string, days: number) => ({ computedAt: daysAgo(days), list, region: "global", rank: 1, itemId: list === "combined" ? null : itemId });
    await t.db.insert(rankings).values([
      ranking("bluesky", 3), // gone
      ranking("bluesky", 1), // kept
      ranking("combined", 8), // gone
      ranking("combined", 3), // kept
    ]);

    await expect(purge(t.db, now)).resolves.toEqual({ items: 0, runs: 0, rankings: 2, centroids: 0 });

    const kept = await t.db.select({ list: rankings.list, at: rankings.computedAt }).from(rankings);
    expect(kept.map((row) => `${row.list} ${row.at.toISOString()}`).sort()).toEqual([`bluesky ${daysAgo(1).toISOString()}`, `combined ${daysAgo(3).toISOString()}`]);
  });
});
