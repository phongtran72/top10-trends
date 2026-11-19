import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planSources } from "@/collectors/registry";
import { fetchRuns } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { describeMissing, formatHealth, listStates, missingLists, when, type ListState } from "./health";
import { upsertSources } from "./sources";

const NOW = new Date("2026-11-19T12:27:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);
const UNAUTHORIZED = "401 api.apify.com: User was not found or authentication token is not valid";

const state = (sourceId: string, region: string, lastStatus: string, lastGoodHoursAgo: number | null, lastError: string | null = null): ListState => ({
  sourceId,
  region,
  lastRunAt: ago(0.3),
  lastStatus,
  lastError,
  lastGoodAt: lastGoodHoursAgo === null ? null : ago(lastGoodHoursAgo),
});

describe("missingLists", () => {
  it("alarms for a list with no stored list for 6 hours or more, and for the hourly update", () => {
    const missing = missingLists(
      [
        state("x", "us", "ok", 0.3),
        state("tiktok", "us", "error", 7, UNAUTHORIZED),
        state("bluesky", "global", "error", 5.9),
        state("google_trends", "gb", "error", 6),
        state("mastodon", "global", "error", null),
        state("reddit", "global", "skipped", 72), // switched off on purpose
        state("heartbeat", "global", "ok", 6.5),
      ],
      NOW,
    );
    expect(missing.map((list) => `${list.sourceId}/${list.region}`)).toEqual(["heartbeat/global", "google_trends/gb", "mastodon/global", "tiktok/us"]);
    expect(missing.find((list) => list.sourceId === "tiktok")?.hoursMissing).toBeCloseTo(7);
    expect(missing.find((list) => list.sourceId === "mastodon")?.hoursMissing).toBeNull();
  });

  it("says nothing when every list is fresh", () => {
    expect(missingLists([state("x", "us", "ok", 0.3), state("heartbeat", "global", "ok", 0.3)], NOW)).toEqual([]);
  });
});

describe("the alarm's wording", () => {
  it("gives times in New York with UTC beside them", () => {
    expect(when(new Date("2026-11-19T10:08:00Z"))).toBe("Nov 19, 5:08 AM New York (10:08 UTC)");
  });

  it("names the list, how long it has been missing and what its newest run said", () => {
    const [tiktok] = missingLists([state("tiktok", "us", "error", 74, UNAUTHORIZED)], NOW);
    expect(describeMissing(tiktok)).toBe(
      `tiktok/us has had no list for 3 days (last ${when(ago(74))}); its newest run, ${when(ago(0.3))}, failed: ${UNAUTHORIZED}`,
    );
    const [update] = missingLists([state("heartbeat", "global", "ok", 7)], NOW);
    expect(describeMissing(update)).toBe(`the hourly update has had no finished run for 7 h (last ${when(ago(7))})`);
  });

  it("sums up the check in one line, then one line per missing list", () => {
    const states = [state("x", "us", "ok", 0.3), state("reddit", "global", "skipped", 72), state("heartbeat", "global", "ok", 0.3)];
    expect(formatHealth(states, missingLists(states, NOW), NOW)).toEqual([
      `health: 2 lists checked at ${when(NOW)}; switched off: reddit/global; none missing`,
    ]);
  });
});

describe("listStates", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    t = await createTestDb();
    await upsertSources(t.db, planSources({ collectors: new Set(), disabled: [], env: {} }));
  });
  afterAll(async () => {
    await t.close();
  });

  it("reads each list's newest run and its newest stored list from fetch_runs", async () => {
    const row = (sourceId: string, region: string, hoursAgo: number, status: string, itemCount: number, error: string | null = null) => ({
      sourceId,
      region,
      startedAt: ago(hoursAgo),
      finishedAt: ago(hoursAgo),
      status,
      itemCount,
      error,
    });
    await t.db.insert(fetchRuns).values([
      row("x", "us", 1.3, "ok", 50),
      row("x", "us", 0.3, "error", 0, "503 api.x.com: Service Unavailable"),
      row("tiktok", "us", 74, "ok", 30),
      row("tiktok", "us", 1.3, "error", 0, UNAUTHORIZED),
      row("tiktok", "us", 0.3, "error", 0, UNAUTHORIZED),
      row("reddit", "global", 0.3, "skipped", 0, "listed in DISABLED_SOURCES"),
      row("bluesky", "global", 0.3, "ok", 0), // an empty list isn't a stored one
      row("pinterest", "us", 60, "ok", 25), // not run for over 48 hours: no longer checked
      row("heartbeat", "global", 50, "ok", 0), // the hourly update is always checked
    ]);

    const states = await listStates(t.db, NOW);
    const byList = new Map(states.map((s) => [`${s.sourceId}/${s.region}`, s]));
    expect([...byList.keys()].sort()).toEqual(["bluesky/global", "heartbeat/global", "reddit/global", "tiktok/us", "x/us"]);
    expect(byList.get("x/us")).toMatchObject({ lastStatus: "error", lastGoodAt: ago(1.3), lastRunAt: ago(0.3) });
    expect(byList.get("tiktok/us")).toMatchObject({ lastStatus: "error", lastError: UNAUTHORIZED, lastGoodAt: ago(74) });
    expect(byList.get("bluesky/global")?.lastGoodAt).toBeNull();
    expect(byList.get("heartbeat/global")?.lastGoodAt).toEqual(ago(50));

    const missing = missingLists(states, NOW).map((list) => `${list.sourceId}/${list.region}`);
    expect(missing).toEqual(["heartbeat/global", "bluesky/global", "tiktok/us"]);
  });
});
