import { describe, expect, it } from "vitest";
import { algoVersion, buildSnapshots } from "./snapshots";

const at = new Date("2026-10-08T12:07:00Z");
const options = { algoVersion: "test" };

describe("buildSnapshots", () => {
  it("records each topic's best rank and metric per platform, its position and score", () => {
    const rows = buildSnapshots(
      [
        { topicId: 1, sourceId: "google_trends", rank: 3, metricValue: 20000 },
        { topicId: 1, sourceId: "bluesky", rank: 2, metricValue: 4200 },
        { topicId: 1, sourceId: "bluesky", rank: 5, metricValue: 90 }, // not its best
        { topicId: 2, sourceId: "google_trends", rank: 1, metricValue: null },
      ],
      at,
      options,
    );
    expect(rows).toEqual([
      {
        takenAt: at,
        region: "global",
        topicId: 2,
        position: 1,
        score: 1,
        platformCount: 1,
        newsCount: 0,
        algoVersion: "test",
        ranks: { google_trends: 1 },
        metrics: {},
      },
      {
        takenAt: at,
        region: "global",
        topicId: 1,
        position: 2,
        score: expect.closeTo(1 / 2 + 0.5 / Math.log2(3), 5),
        platformCount: 2,
        newsCount: 0,
        algoVersion: "test",
        ranks: { google_trends: 3, bluesky: 2 },
        metrics: { google_trends: 20000, bluesky: 4200 },
      },
    ]);
  });

  it("leaves YouTube out entirely, as its policy requires", () => {
    const rows = buildSnapshots(
      [
        { topicId: 1, sourceId: "bluesky", rank: 2, metricValue: 10 },
        { topicId: 1, sourceId: "youtube", rank: 1, metricValue: 2_000_000 },
        { topicId: 2, sourceId: "youtube", rank: 2, metricValue: 900_000 }, // YouTube only: no row
      ],
      at,
      options,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ topicId: 1, platformCount: 1, ranks: { bluesky: 2 }, metrics: { bluesky: 10 } });
    expect(rows[0].score).toBeCloseTo(0.5 / Math.log2(3));
  });

  it("keeps topics that only corroborating platforms have, without a position", () => {
    const [row] = buildSnapshots([{ topicId: 7, sourceId: "twitch", rank: 4, metricValue: null }], at, options);
    expect(row).toMatchObject({ topicId: 7, position: null, score: null, platformCount: 1, ranks: { twitch: 4 } });
  });
});

describe("X's two lists in a snapshot", () => {
  it("records the US list's rank and metric when both lists have the topic, and the Worldwide rank with no position when only it does", () => {
    const rows = buildSnapshots(
      [
        { topicId: 1, sourceId: "x", rank: 3, region: "global", metricValue: 900 },
        { topicId: 1, sourceId: "x", rank: 19, region: "us", metricValue: 40 },
        { topicId: 2, sourceId: "x", rank: 1, region: "global", metricValue: 5000 },
      ],
      at,
      options,
    );
    expect(rows.map((r) => [r.topicId, r.position, r.ranks, r.metrics])).toEqual([
      [1, 1, { x: 19 }, { x: 40 }],
      [2, null, { x: 1 }, { x: 5000 }],
    ]);
  });
});

describe("snapshot metadata", () => {
  it("names the method that made a row", () => {
    expect(algoVersion(0.86)).toBe("nomic-embed-text-v1.5.q8.384/t0.86/r6");
    expect(algoVersion(0.8, true)).toBe("nomic-embed-text-v1.5.q8.384/t0.80/r6+replay");
  });

  it("records each topic's news count, defaulting to 0", () => {
    const rows = buildSnapshots(
      [
        { topicId: 1, sourceId: "google_trends", rank: 1 },
        { topicId: 2, sourceId: "bluesky", rank: 1 },
      ],
      at,
      { algoVersion: "test", newsCount: new Map([[1, 3]]) },
    );
    expect(rows.map((r) => [r.topicId, r.newsCount])).toEqual([
      [1, 3],
      [2, 0],
    ]);
  });
});
