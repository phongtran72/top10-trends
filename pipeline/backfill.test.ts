import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APIFY_API } from "@/collectors/apify";
import { instagram, INSTAGRAM_ACTOR } from "@/collectors/instagram";
import { planSources } from "@/collectors/registry";
import type { TrendItem } from "@/collectors/types";
import { fetchRuns, trendItems } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Http } from "@/lib/http";
import { missedHours, pinnedHttp, recoverHour, RECOVERED_NOTE, runAt, type ApifyRun } from "./backfill";
import { upsertSources } from "./sources";

const at = (iso: string) => new Date(iso);
const run = (id: string, finished: string): ApifyRun => ({ id, finishedAt: at(finished), defaultDatasetId: `ds-${id}` });
const UNAUTHORIZED = "401 api.apify.com: User was not found or authentication token is not valid";

describe("runAt", () => {
  it("picks the latest run that had finished by then, as a live run would have read it", () => {
    const runs = [run("b", "2026-11-12T13:50:12Z"), run("a", "2026-11-12T01:50:10Z"), run("c", "2026-11-12T19:50:09Z")];
    expect(runAt(runs, at("2026-11-12T09:08:00Z"))?.id).toBe("a");
    expect(runAt(runs, at("2026-11-12T14:08:00Z"))?.id).toBe("b");
    expect(runAt(runs, at("2026-11-12T13:50:12Z"))?.id).toBe("b");
    expect(runAt(runs, at("2026-11-12T01:00:00Z"))).toBeNull();
  });
});

describe("pinnedHttp", () => {
  it("answers the collector's latest-run lookup with the chosen run and reads that run's dataset", async () => {
    const asked: string[] = [];
    const http: Http = {
      getJson: async (url) => {
        asked.push(url);
        if (url === `${APIFY_API}/datasets/ds-b/items?clean=true`) {
          return [
            { record_type: "trending_topic", topic: "invented topic two", keyword_slug: "invented-topic-two", rank: 2, media_count: 50 },
            { record_type: "trending_topic", topic: "invented topic one", keyword_slug: "invented-topic-one", rank: 1, media_count: 90 },
          ];
        }
        throw new Error(`unexpected ${url}`);
      },
      getXml: async () => null,
      postFormJson: async () => null,
    };
    const items = await instagram.fetch("global", {
      http: pinnedHttp(http, INSTAGRAM_ACTOR, run("b", "2026-11-12T13:50:12Z")),
      env: { APIFY_TOKEN: "test-token" },
      now: at("2026-11-12T14:08:00Z"),
    });
    expect(items.map((item) => [item.rank, item.title])).toEqual([
      [1, "invented topic one"],
      [2, "invented topic two"],
    ]);
    // Only the dataset went to Apify; the latest-run lookup never left the process.
    expect(asked).toEqual([`${APIFY_API}/datasets/ds-b/items?clean=true`]);
  });
});

describe("recovering a failed hour", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    t = await createTestDb();
    await upsertSources(t.db, planSources({ collectors: new Set(), disabled: [], env: {} }));
  });
  afterAll(async () => {
    await t.close();
  });

  it("stores the list under the hour's own row and time, keeps it an error with a note, and does it once", async () => {
    const row = (sourceId: string, region: string, startedAt: string, status: string, error: string | null) => ({
      sourceId,
      region,
      startedAt: at(startedAt),
      finishedAt: new Date(at(startedAt).getTime() + 2_000),
      status,
      itemCount: 0,
      error,
    });
    // Only the first row qualifies: the others failed for another reason, didn't fail, or are outside the window.
    const [missed] = await t.db
      .insert(fetchRuns)
      .values([
        row("instagram", "global", "2026-11-12T09:08:40Z", "error", UNAUTHORIZED),
        row("tiktok", "us", "2026-11-12T09:08:40Z", "error", "500 api.apify.com: Internal Server Error"),
        row("reddit", "global", "2026-11-12T09:08:40Z", "error", "404 www.reddit.com: Not Found"),
        row("pinterest", "us", "2026-11-12T09:08:40Z", "ok", null),
        row("instagram", "global", "2026-11-19T09:08:40Z", "error", UNAUTHORIZED),
      ])
      .returning({ id: fetchRuns.id });

    const hours = await missedHours(t.db, at("2026-11-12T00:00:00Z"), at("2026-11-19T00:00:00Z"));
    expect(hours.map((hour) => hour.runId)).toEqual([missed.id]);

    const items: TrendItem[] = [
      { source: "instagram", region: "global", rank: 1, title: "invented topic one", url: "https://www.instagram.com/popular/invented-topic-one/" },
      { source: "instagram", region: "global", rank: 2, title: "invented topic two", url: "https://www.instagram.com/popular/invented-topic-two/" },
    ];
    expect(await recoverHour(t.db, hours[0], items)).toBe(2);
    expect(await recoverHour(t.db, hours[0], items)).toBe(0);

    const stored = await t.db.select().from(trendItems);
    expect(stored).toHaveLength(2);
    expect(stored.every((item) => item.runId === missed.id)).toBe(true);
    expect(stored.every((item) => item.fetchedAt.toISOString() === "2026-11-12T09:08:42.000Z")).toBe(true);

    const [after] = await t.db.select().from(fetchRuns).where(eq(fetchRuns.id, missed.id));
    expect(after.status).toBe("error");
    expect(after.itemCount).toBe(2);
    expect(after.error).toBe(`${UNAUTHORIZED}${RECOVERED_NOTE}`);
    expect(await missedHours(t.db, at("2026-11-12T00:00:00Z"), at("2026-11-19T00:00:00Z"))).toEqual([]);
  });
});
