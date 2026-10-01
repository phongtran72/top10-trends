import { asc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { getSource, planSources, type SourceId } from "@/collectors/registry";
import type { Collector, CollectorContext } from "@/collectors/types";
import { trendItems } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { createHttp } from "@/lib/http";
import { collect, describeCollectorError, writeResults, type ListResult } from "./collect";
import { upsertSources } from "./sources";

const ctx: CollectorContext = {
  http: createHttp({ fetch: (async () => new Response("unused")) as typeof fetch }),
  env: {},
  now: new Date("2026-09-30T12:07:00Z"),
};

function plansFor(ids: SourceId[], env: Record<string, string> = {}) {
  return planSources({ collectors: new Set(ids), disabled: [], env });
}

describe("collect", () => {
  it("runs every region of a source and keeps each failure to its own list", async () => {
    const seen: string[] = [];
    const collectors = new Map<SourceId, Collector>([
      [
        "x",
        {
          id: "x",
          fetch: async (region) => {
            seen.push(region);
            if (region === "us") throw new Error("boom");
            return [{ source: "x", region, rank: 1, title: "Trend", url: "https://x.com/search?q=Trend" }];
          },
        },
      ],
    ]);
    const results = await collect(plansFor(["x"], { X_BEARER_TOKEN: "t" }), collectors, ctx);
    expect(seen.sort()).toEqual(["global", "us"]);
    expect(results.map((r) => [r.region, r.status, r.items.length, r.error])).toEqual([
      ["global", "ok", 1, undefined],
      ["us", "error", 0, "boom"],
    ]);
  });

  it("stops waiting for a collector after its budget", async () => {
    const collectors = new Map<SourceId, Collector>([
      ["bluesky", { id: "bluesky", fetch: () => new Promise(() => {}) }],
    ]);
    const [result] = await collect(plansFor(["bluesky"]), collectors, ctx, { budgetMs: 20 });
    expect(result).toMatchObject({ status: "error", error: "over the 0.02s budget" });
  });

  it("records skipped sources and ignores ones without a collector", async () => {
    const collectors = new Map<SourceId, Collector>([["twitch", { id: "twitch", fetch: async () => [] }]]);
    const results = await collect(plansFor(["twitch"]), collectors, ctx);
    expect(results.map((r) => [r.source.id, r.status, r.error])).toEqual([
      ["twitch", "skipped", "missing TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET"],
    ]);
  });
});

describe("writeResults", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    t = await createTestDb();
    await upsertSources(t.db, plansFor(["bluesky", "mastodon"]));
  });

  afterAll(async () => {
    await t.close();
  });

  it("stores Bluesky's status label for every item, tidied, and null where a source has none", async () => {
    const at = new Date("2026-10-01T03:08:00Z");
    const list = (id: SourceId, items: ListResult["items"]): ListResult => ({
      source: getSource(id), region: "global", status: "ok", items, startedAt: at, finishedAt: at,
    });
    await writeResults(t.db, [
      list("bluesky", [
        { source: "bluesky", region: "global", rank: 1, title: "A", url: "https://bsky.app/a", flags: { status: " Trending " } },
        { source: "bluesky", region: "global", rank: 2, title: "B", url: "https://bsky.app/b", flags: { status: "cooling" } },
        { source: "bluesky", region: "global", rank: 3, title: "C", url: "https://bsky.app/c", flags: { status: "" } },
      ]),
      list("mastodon", [{ source: "mastodon", region: "global", rank: 1, title: "#tag", url: "https://mastodon.social/tags/tag" }]),
    ]);
    const rows = await t.db.select().from(trendItems).orderBy(asc(trendItems.sourceId), asc(trendItems.rank));
    expect(rows.map((r) => [r.sourceId, r.rank, r.status])).toEqual([
      ["bluesky", 1, "trending"],
      ["bluesky", 2, "cooling"], // stored whatever the rank step does with it
      ["bluesky", 3, null],
      ["mastodon", 1, null],
    ]);
  });
});

describe("describeCollectorError", () => {
  it("summarizes schema changes without the payload", () => {
    const error = z.object({ trends: z.array(z.string()) }).safeParse({ trends: [1] }).error;
    expect(describeCollectorError(error)).toBe("unexpected response: trends.0: Invalid input: expected string, received number");
  });

  it("strips URLs from other errors", () => {
    expect(describeCollectorError(new Error("failed at https://api.test/x?key=1"))).toBe("failed at [url]");
  });
});
