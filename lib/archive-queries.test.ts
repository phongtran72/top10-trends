import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSource, planSources, type SourceId } from "@/collectors/registry";
import type { Region } from "@/collectors/types";
import { createTestDb } from "@/db/test-db";
import { writeResults, type ListResult } from "@/pipeline/collect";
import { rankRun } from "@/pipeline/rank";
import { upsertSources } from "@/pipeline/sources";
import { WORD_EMBEDDER_THRESHOLD, wordEmbedder } from "@/pipeline/test-embedder";
import { archiveDay, archiveDays, archivePlatformLists, parseDay } from "./archive-queries";
import { dayName } from "./format";

let t: Awaited<ReturnType<typeof createTestDb>>;
const at = (day: number, hour: number) => new Date(Date.UTC(2026, 9, day, hour, 7));

function list(sourceId: SourceId, region: Region, when: Date, titles: string[]): ListResult {
  return {
    source: getSource(sourceId),
    region,
    status: "ok",
    items: titles.map((title, i) => ({ source: sourceId, region, rank: i + 1, title, url: `https://example.com/${sourceId}/${region}/${when.getTime()}/${i + 1}` })),
    startedAt: when,
    finishedAt: when,
  };
}

async function run(when: Date, results: ListResult[]) {
  const itemIds = await writeResults(t.db, results);
  await rankRun({ db: t.db, results, itemIds, now: when, embedder: wordEmbedder, blocklist: new Set(), threshold: WORD_EMBEDDER_THRESHOLD });
}

beforeAll(async () => {
  t = await createTestDb();
  await upsertSources(t.db, planSources({ collectors: new Set(), disabled: [], env: {} }));
  await run(at(10, 22), [list("google_trends", "us", at(10, 22), ["harbor fire"]), list("bluesky", "global", at(10, 22), ["Budget vote"])]);
  await run(at(11, 9), [
    list("google_trends", "us", at(11, 9), ["tower strike", "harbor fire"]),
    list("google_trends", "gb", at(11, 9), ["quartz derby"]),
    list("x", "global", at(11, 9), ["Worldwide Only"]),
    list("x", "us", at(11, 9), ["Tower Strike"]),
  ]);
  await run(at(11, 10), [list("google_trends", "us", at(11, 10), ["tower strike"])]);
});

afterAll(async () => {
  await t.close();
});

describe("parseDay and dayName", () => {
  it("accept only real dates written YYYY-MM-DD", () => {
    expect(parseDay("2026-10-11")?.toISOString()).toBe("2026-10-11T00:00:00.000Z");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("2026-10-1")).toBeNull();
    expect(parseDay("yesterday")).toBeNull();
    expect(dayName("2026-10-11")).toBe("Sunday, October 11, 2026");
    expect(dayName("2026-10-11", "short")).toBe("Oct 11");
  });
});

describe("archiveDays", () => {
  it("lists each UTC day with its number of hourly lists, newest first", async () => {
    expect(await archiveDays(t.db)).toEqual([
      { date: "2026-10-11", lists: 2 },
      { date: "2026-10-10", lists: 1 },
    ]);
  });
});

describe("archiveDay", () => {
  it("returns that day's combined top 10s for the view, oldest first", async () => {
    const day = await archiveDay(t.db, "2026-10-11", "us");
    expect(day.map((l) => [l.at, l.entries.map((e) => `${e.rank} ${e.label}`)])).toEqual([
      [at(11, 9).toISOString(), ["1 tower strike", "2 harbor fire"]],
      [at(11, 10).toISOString(), ["1 tower strike", "2 harbor fire"]],
    ]);
    // The Global view also counts the UK feed.
    const global = await archiveDay(t.db, "2026-10-11", "global");
    expect(global[0].entries.map((e) => e.label)).toContain("quartz derby");
    expect(global[0].entries[0].slug).toMatch(/-2026101[01]$/);
    expect(await archiveDay(t.db, "2026-10-12", "global")).toEqual([]);
    expect(await archiveDay(t.db, "not-a-date", "global")).toEqual([]);
  });
});

describe("archivePlatformLists", () => {
  it("returns each platform's list for one run, for the feed its page shows, in the site's order", async () => {
    const lists = await archivePlatformLists(t.db, at(11, 9).toISOString());
    expect(lists.map((l) => [l.sourceId, l.feed, l.items.map((i) => `${i.rank} ${i.title}`)])).toEqual([
      ["x", "us", ["1 Tower Strike"]],
      ["google_trends", "us", ["1 tower strike", "2 harbor fire"]],
    ]);
    expect(await archivePlatformLists(t.db, at(12, 9).toISOString())).toEqual([]);
  });
});
