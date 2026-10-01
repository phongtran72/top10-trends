import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc } from "drizzle-orm";
import { getSource } from "@/collectors/registry";
import type { SourceId } from "@/collectors/registry";
import type { TrendItem } from "@/collectors/types";
import { tiktokCurves } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { ListResult } from "./collect";
import { curveRows, keepCurves } from "./curves";
import type { Db } from "./db";

let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

function list(sourceId: SourceId, items: Partial<TrendItem>[], finishedAt: Date, status: ListResult["status"] = "ok"): ListResult {
  return {
    source: getSource(sourceId),
    region: "us",
    status,
    startedAt: finishedAt,
    finishedAt,
    items: items.map((item, index) => ({
      source: sourceId,
      region: "us",
      rank: index + 1,
      title: `#tag${index + 1}`,
      url: `https://www.tiktok.com/tag/tag${index + 1}`,
      ...item,
    })),
  };
}

const monday = new Date("2026-10-05T07:07:00Z");
const curve = (days: string[], values: number[]) => days.map((day, i) => ({ day, value: values[i] }));

describe("curveRows", () => {
  it("makes one row per day of each TikTok curve, named by the curve's last day", () => {
    const rows = curveRows([
      list(
        "tiktok",
        [
          { series: curve(["2026-10-03", "2026-10-04"], [40, 100]), flags: { direction: "up" } },
          { series: curve(["2026-10-04", "2026-10-04"], [7, 8]) }, // a repeated day keeps its first value
          {}, // no curve
        ],
        monday,
      ),
    ]);
    expect(rows).toEqual([
      { title: "#tag1", windowEnd: "2026-10-04", day: "2026-10-03", value: 40, direction: "up", fetchedAt: monday },
      { title: "#tag1", windowEnd: "2026-10-04", day: "2026-10-04", value: 100, direction: "up", fetchedAt: monday },
      { title: "#tag2", windowEnd: "2026-10-04", day: "2026-10-04", value: 7, direction: null, fetchedAt: monday },
    ]);
  });

  it("ignores other sources and failed lists", () => {
    const series = curve(["2026-10-04"], [50]);
    expect(curveRows([list("bluesky", [{ series }], monday), list("tiktok", [{ series }], monday, "error")])).toEqual([]);
  });
});

describe("keepCurves", () => {
  it("stores each curve once, however many hourly runs read it, and keeps the next day's curve too", async () => {
    const first = [list("tiktok", [{ series: curve(["2026-10-03", "2026-10-04"], [40, 100]), flags: { direction: "up" } }], monday)];
    await expect(keepCurves(t.db, first)).resolves.toBe("curves: 2 new TikTok curve days");

    const anHourLater = new Date(monday.getTime() + 3_600_000);
    const again = [list("tiktok", [{ series: curve(["2026-10-03", "2026-10-04"], [40, 100]) }], anHourLater)];
    await expect(keepCurves(t.db, again)).resolves.toBeNull();

    const nextDay = new Date(monday.getTime() + 24 * 3_600_000);
    const next = [list("tiktok", [{ series: curve(["2026-10-04", "2026-10-05"], [55, 100]) }], nextDay)];
    await expect(keepCurves(t.db, next)).resolves.toBe("curves: 2 new TikTok curve days");

    const stored = await t.db.select().from(tiktokCurves).orderBy(asc(tiktokCurves.windowEnd), asc(tiktokCurves.day));
    expect(stored.map((r) => [r.windowEnd, r.day, r.value, r.direction, r.fetchedAt.toISOString()])).toEqual([
      ["2026-10-04", "2026-10-03", 40, "up", monday.toISOString()],
      ["2026-10-04", "2026-10-04", 100, "up", monday.toISOString()],
      ["2026-10-05", "2026-10-04", 55, null, nextDay.toISOString()], // the same day, rescaled in the newer curve
      ["2026-10-05", "2026-10-05", 100, null, nextDay.toISOString()],
    ]);
  });

  it("returns null when there's nothing to keep, and never throws", async () => {
    await expect(keepCurves(t.db, [])).resolves.toBeNull();
    const broken = {
      insert: () => {
        throw new Error("connection lost");
      },
    } as unknown as Db;
    const results = [list("tiktok", [{ series: curve(["2026-10-04"], [50]) }], monday)];
    await expect(keepCurves(broken, results)).resolves.toBe("curves: failed: connection lost");
  });
});
