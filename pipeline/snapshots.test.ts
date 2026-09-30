import { describe, expect, it } from "vitest";
import { buildSnapshots } from "./snapshots";

const at = new Date("2026-10-08T12:07:00Z");

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
    );
    expect(rows).toEqual([
      {
        takenAt: at,
        region: "global",
        topicId: 2,
        position: 1,
        score: 1,
        platformCount: 1,
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
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ topicId: 1, platformCount: 1, ranks: { bluesky: 2 }, metrics: { bluesky: 10 } });
    expect(rows[0].score).toBeCloseTo(0.5 / Math.log2(3));
  });

  it("keeps topics that only corroborating platforms have, without a position", () => {
    const [row] = buildSnapshots([{ topicId: 7, sourceId: "twitch", rank: 4, metricValue: null }], at);
    expect(row).toMatchObject({ topicId: 7, position: null, score: null, platformCount: 1, ranks: { twitch: 4 } });
  });
});
