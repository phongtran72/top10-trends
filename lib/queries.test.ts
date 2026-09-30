import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSource, planSources } from "@/collectors/registry";
import { fetchRuns, trendItems } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { upsertSources } from "@/pipeline/sources";
import { platformList, sourceStatuses } from "./queries";

let t: Awaited<ReturnType<typeof createTestDb>>;
const now = new Date("2026-09-30T12:10:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

async function run(sourceId: "bluesky" | "google_trends" | "heartbeat", region: string, at: Date, status: string, titles: string[] = [], error?: string) {
  const [row] = await t.db
    .insert(fetchRuns)
    .values({ sourceId, region, startedAt: at, finishedAt: at, status, itemCount: titles.length, error })
    .returning();
  if (titles.length > 0) {
    await t.db.insert(trendItems).values(
      titles.map((title, i) => ({
        runId: row.id,
        sourceId,
        region,
        rank: i + 1,
        title,
        url: `https://example.com/${i + 1}`,
        metricValue: 100 - i,
        metricLabel: "posts",
        fetchedAt: at,
      })),
    );
  }
}

beforeAll(async () => {
  t = await createTestDb();
  await upsertSources(t.db, planSources({ collectors: new Set(), disabled: [], env: {} }));
  await run("bluesky", "global", hoursAgo(30), "ok", ["Old"]);
  await run("bluesky", "global", hoursAgo(2), "ok", Array.from({ length: 12 }, (_, i) => `Trend ${i + 1}`));
  await run("bluesky", "global", hoursAgo(1), "error", [], "503 public.api.bsky.app: Service Unavailable");
  await run("google_trends", "us", hoursAgo(1), "ok", ["query one", "query two"]);
  await run("heartbeat", "global", hoursAgo(1), "ok");
});

afterAll(async () => {
  await t.close();
});

describe("platformList", () => {
  it("returns the top 10 of the latest successful run, ignoring later failures", async () => {
    const list = await platformList(t.db, getSource("bluesky"));
    expect(list?.fetchedAt).toBe(hoursAgo(2).toISOString());
    expect(list?.items).toHaveLength(10);
    expect(list?.items[0]).toEqual({ rank: 1, title: "Trend 1", url: "https://example.com/1", metricValue: 100, metricLabel: "posts" });
    expect(list?.items.at(-1)?.title).toBe("Trend 10");
  });

  it("reads a US-only source's US feed", async () => {
    const list = await platformList(t.db, getSource("google_trends"));
    expect(list).toMatchObject({ region: "us", items: [{ title: "query one" }, { title: "query two" }] });
  });

  it("returns null when a source has no successful list", async () => {
    expect(await platformList(t.db, getSource("youtube"))).toBeNull();
  });
});

describe("sourceStatuses", () => {
  it("reports last success, last error and 24-hour counts per source", async () => {
    const statuses = await sourceStatuses(t.db, now);
    const bluesky = statuses.find((s) => s.id === "bluesky");
    expect(bluesky).toMatchObject({
      lastStatus: "error",
      lastRunAt: hoursAgo(1).toISOString(),
      lastSuccessAt: hoursAgo(2).toISOString(),
      lastError: { at: hoursAgo(1).toISOString(), message: "503 public.api.bsky.app: Service Unavailable" },
      runs24h: 2,
      ok24h: 1,
    });
    expect(statuses.find((s) => s.id === "youtube")).toMatchObject({ lastRunAt: null, runs24h: 0, lastError: null });
    expect(statuses.find((s) => s.id === "heartbeat")).toMatchObject({ runs24h: 1, ok24h: 1 });
    expect(statuses).toHaveLength(11);
  });
});
