import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSource, planSources } from "@/collectors/registry";
import { fetchRuns, trendItems } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { upsertSources } from "@/pipeline/sources";
import { platformList, recentTopItems, sourceStatuses, spendThisMonth } from "./queries";

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

describe("recentTopItems", () => {
  it("returns top-10 items since a time, oldest first, with ISO dates", async () => {
    const items = await recentTopItems(t.db, hoursAgo(3));
    expect(new Set(items.map((i) => i.fetchedAt))).toEqual(new Set([hoursAgo(2).toISOString(), hoursAgo(1).toISOString()]));
    expect(items.every((i) => i.rank <= 10)).toBe(true);
    expect(items.filter((i) => i.sourceId === "bluesky")).toHaveLength(10);
    expect(items[0]).toMatchObject({ sourceId: "bluesky", rank: 1, title: "Trend 1", fetchedAt: hoursAgo(2).toISOString() });
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
    expect(statuses).toHaveLength(12);
  });
});

describe("spendThisMonth", () => {
  it("prices X requests exactly and estimates Apify sources from their schedules, from each one's first run", async () => {
    const at = (h: number, sourceId: string, status: string) => ({
      sourceId,
      region: "global",
      startedAt: hoursAgo(h),
      finishedAt: hoursAgo(h),
      status,
      itemCount: 0,
    });
    await t.db.insert(fetchRuns).values([
      ...Array.from({ length: 10 }, (_, i) => at(i + 1, "x", "ok")),
      at(20, "x", "error"),
      at(21, "x", "error"),
      at(22, "x", "skipped"), // never reached X
      at(24 * 40, "x", "ok"), // last month
      at(24 * 29 + 6, "tiktok", "ok"), // Sep 1 06:10: running all month
      at(5, "tiktok", "ok"),
      at(3, "instagram", "ok"),
      at(4, "pinterest", "ok"),
    ]);
    const spend = await spendThisMonth(t.db, now);
    expect(spend.month).toBe("2026-09");
    const [x, tiktok, instagram, pinterest] = spend.lines;
    expect(x).toMatchObject({ service: "X", detail: "12 trend requests × $0.010" });
    expect(x.toDate).toBeCloseTo(0.12);
    // 12 requests in the 21 hours since X's first one, at the same pace until the month ends at midnight.
    expect(x.projected).toBeCloseTo(0.12 + (0.12 / 21) * (11 + 50 / 60), 5);
    // Daily since Sep 1: 30 runs so far on Sep 30 at 12:10, and 30 in September.
    expect(tiktok).toMatchObject({ service: "TikTok (Apify)", detail: "about 30 runs × $0.055, estimated from the schedule" });
    expect(tiktok.toDate).toBeCloseTo(30 * 0.055);
    expect(tiktok.projected).toBeCloseTo(30 * 0.055);
    // Every 6 hours from 09:10 today: 1 run so far, and 3 by midnight; nothing for the days before it started.
    expect(instagram).toMatchObject({ service: "Instagram (Apify)", detail: "about 1 run × $0.020, estimated from the schedule" });
    expect(instagram.toDate).toBeCloseTo(0.02);
    expect(instagram.projected).toBeCloseTo(3 * 0.02);
    // Twice a week from 08:10 today: 1 run this month.
    expect(pinterest).toMatchObject({ service: "Pinterest (Apify)", detail: "about 1 run × $0.030, estimated from the schedule" });
    expect(pinterest.projected).toBeCloseTo(0.03);
    // Apify's free $5 a month covers TikTok, Instagram and Pinterest, so only X is out of pocket.
    expect(spend.outOfPocket).toBeCloseTo(x.projected, 5);
  });
});
