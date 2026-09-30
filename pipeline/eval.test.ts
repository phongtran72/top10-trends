import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSource, planSources, type SourceId } from "@/collectors/registry";
import type { Region } from "@/collectors/types";
import { createTestDb } from "@/db/test-db";
import { writeResults, type ListResult } from "./collect";
import { evalHour, formatEvalHour, sampleHours } from "./eval";
import { rankRun } from "./rank";
import { upsertSources } from "./sources";
import { wordEmbedder } from "./test-embedder";

let t: Awaited<ReturnType<typeof createTestDb>>;
const hours = [0, 1, 2].map((h) => new Date(Date.UTC(2026, 9, 8, 10 + h, 7)));

function list(sourceId: SourceId, region: Region, at: Date, titles: string[]): ListResult {
  return {
    source: getSource(sourceId),
    region,
    status: "ok",
    items: titles.map((title, i) => ({ source: sourceId, region, rank: i + 1, title, url: `https://example.com/${i}` })),
    // Lists are fetched a moment after the run (and its rankings) start.
    startedAt: new Date(at.getTime() + 2_000),
    finishedAt: new Date(at.getTime() + 3_000),
  };
}

beforeAll(async () => {
  t = await createTestDb();
  await upsertSources(t.db, planSources({ collectors: new Set(), disabled: [], env: {} }));
  for (const at of hours) {
    const results = [list("google_trends", "us", at, ["world series", "flood watch"]), list("youtube", "us", at, ["World Series"])];
    const itemIds = await writeResults(t.db, results);
    await rankRun({ db: t.db, results, itemIds, now: at, embedder: wordEmbedder, blocklist: new Set() });
  }
});

afterAll(async () => {
  await t.close();
});

describe("eval", () => {
  it("samples distinct past hours in time order", async () => {
    const sampled = await sampleHours(t.db, 2, new Date("2026-10-08T13:00:00Z"), 7, () => 0);
    expect(sampled).toHaveLength(2);
    expect(sampled[0].getTime()).toBeLessThan(sampled[1].getTime());
    expect(await sampleHours(t.db, 10, new Date("2026-10-08T13:00:00Z"))).toHaveLength(3);
  });

  it("prints an hour's combined top 10 with each topic's members", async () => {
    const hour = await evalHour(t.db, hours[1]);
    expect(formatEvalHour(hour).slice(0, 6)).toEqual([
      "== 2026-10-08 11:07 UTC",
      "   1. world series  (score 1.80)",
      "        google_trends #1: world series",
      "        youtube #1: World Series",
      "   2. flood watch  (score 0.63)",
      "        google_trends #2: flood watch",
    ]);
  });
});
