import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSource, planSources, type SourceId } from "@/collectors/registry";
import type { Region } from "@/collectors/types";
import { rankings, topicSnapshots, topics, trendItems } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { writeResults, type ListResult } from "./collect";
import { copyLists, loadSlots, memoEmbedder, rebuildCheck, replaySlots, resetDerived, tuneStats } from "./replay";
import { upsertSources } from "./sources";
import { wordEmbedder } from "./test-embedder";

let live: Awaited<ReturnType<typeof createTestDb>>;
let scratch: Awaited<ReturnType<typeof createTestDb>>;
const hour = (h: number, minute = 7) => new Date(Date.UTC(2026, 9, 1, h, minute));

function list(sourceId: SourceId, region: Region, at: Date, titles: string[]): ListResult {
  return {
    source: getSource(sourceId),
    region,
    status: "ok",
    items: titles.map((title, i) => ({ source: sourceId, region, rank: i + 1, title, url: `https://example.com/${sourceId}/${i}` })),
    startedAt: at,
    finishedAt: at,
  };
}

beforeAll(async () => {
  live = await createTestDb();
  scratch = await createTestDb();
  await upsertSources(live.db, planSources({ collectors: new Set(), disabled: [], env: {} }));
  // Three hourly runs, plus a manual run in hour 11 that should replace Bluesky's 11:07 list.
  await writeResults(live.db, [list("google_trends", "us", hour(10), ["world series", "flood watch"]), list("bluesky", "global", hour(10), ["Election night"])]);
  await writeResults(live.db, [list("google_trends", "us", hour(11), ["world series"]), list("bluesky", "global", hour(11), ["Old Bluesky"])]);
  await writeResults(live.db, [list("bluesky", "global", hour(11, 40), ["World Series"])]);
  await writeResults(live.db, [list("google_trends", "us", hour(12), ["flood watch"]), list("youtube", "us", hour(12), ["World Series highlights"])]);
});

afterAll(async () => {
  await live.close();
  await scratch.close();
});

describe("loadSlots", () => {
  it("groups stored lists by hour, the latest list per source winning", async () => {
    const slots = await loadSlots(live.db);
    expect(slots.map((s) => s.at.toISOString())).toEqual([hour(10), hour(11), hour(12)].map((d) => d.toISOString()));
    expect(slots[1].results.map((r) => [r.source.id, r.items.map((i) => i.title)])).toEqual([
      ["google_trends", ["world series"]],
      ["bluesky", ["World Series"]],
    ]);
    const [item] = slots[1].results[0].items;
    expect(slots[1].itemIds.get(item)).toBeGreaterThan(0);
  });
});

describe("tuning in a scratch copy", () => {
  it("copies the lists and replays them at each threshold", async () => {
    await expect(copyLists(live.db, scratch.db)).resolves.toBe(8);
    const slots = await loadSlots(scratch.db);
    const embedder = memoEmbedder(wordEmbedder);

    await replaySlots(scratch.db, slots, { threshold: 0.8, embedder, blocklist: new Set() });
    const strict = await tuneStats(scratch.db, 0.8);
    expect(strict.crossPlatform.map((t) => [t.label, Object.keys(t.titles).sort()])).toEqual([
      ["world series", ["bluesky", "google_trends", "youtube"]],
    ]);
    // Hour 10: 3 topics; hour 11: world series, plus flood watch still in Google's 3-hour window;
    // hour 12: world series (Bluesky 11:40, and Google's window) and flood watch.
    expect(strict.top10Entries).toBe(7);
    const snaps = await scratch.db.select().from(topicSnapshots);
    expect(snaps).not.toHaveLength(0);
    expect(new Set(snaps.map((s) => s.algoVersion))).toEqual(new Set(["all-minilm-l6-v2.q8/t0.80/r1+replay"]));

    await resetDerived(scratch.db);
    expect(await scratch.db.select().from(topics)).toHaveLength(0);
    await replaySlots(scratch.db, slots, { threshold: 0.99, embedder, blocklist: new Set() });
    const unmatched = await tuneStats(scratch.db, 0.99);
    // Identical text still merges; "World Series highlights" (about 0.82 similar) no longer does.
    expect(unmatched.crossPlatform.map((t) => [t.label, Object.keys(t.titles).sort()])).toEqual([
      ["world series", ["bluesky", "google_trends"]],
    ]);
  });
});

describe("memoEmbedder", () => {
  it("embeds each distinct text once", async () => {
    let calls = 0;
    const embed = memoEmbedder(async (texts) => {
      calls += texts.length;
      return wordEmbedder(texts);
    });
    await embed(["a b", "c", "a b"]);
    await embed(["c", "d"]);
    expect(calls).toBe(3);
  });
});

describe("rebuildCheck", () => {
  it("allows a rebuild while the stored lists cover the derived data, and refuses after items are purged", async () => {
    const before = await rebuildCheck(scratch.db);
    expect(before.safe).toBe(true);
    // Simulate the 28-day purge of the oldest hour's items.
    const { lt } = await import("drizzle-orm");
    await scratch.db.delete(rankings).where(lt(rankings.computedAt, hour(11)));
    await scratch.db.delete(trendItems).where(lt(trendItems.fetchedAt, hour(11)));
    const [first] = await scratch.db.select().from(rankings).limit(1);
    await scratch.db.insert(rankings).values({ ...first, id: undefined, computedAt: hour(9) });
    const after = await rebuildCheck(scratch.db);
    expect(after.safe).toBe(false);
  });
});
