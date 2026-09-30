import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSource, planSources, type SourceId } from "@/collectors/registry";
import type { Region, TrendItem } from "@/collectors/types";
import { createTestDb } from "@/db/test-db";
import { writeResults, type ListResult } from "@/pipeline/collect";
import { rankRun } from "@/pipeline/rank";
import { upsertSources } from "@/pipeline/sources";
import { wordEmbedder } from "@/pipeline/test-embedder";
import { platformList } from "./queries";
import { combinedTop, topicDetail } from "./topic-queries";

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
  await rankRun({ db: t.db, results, itemIds, now: at, embedder: wordEmbedder, blocklist: new Set(["caturday"]) });
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
