import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planSources } from "@/collectors/registry";
import { fetchRuns, trendItems } from "@/db/schema";
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

    await expect(purge(t.db, now)).resolves.toEqual({ items: 1, runs: 1 });

    const items = await t.db.select().from(trendItems);
    expect(items.map((i) => i.fetchedAt.getTime()).sort()).toEqual([daysAgo(27).getTime(), daysAgo(0).getTime()]);
    expect(await t.db.select().from(fetchRuns)).toHaveLength(3);
    await expect(purge(t.db, now)).resolves.toEqual({ items: 0, runs: 0 });
  });
});
