import { describe, expect, it } from "vitest";
import { scoreTopics } from "./score";

describe("scoreTopics", () => {
  it("reproduces PLAN.md's examples: 1.0 and 1.81", () => {
    const [alone] = scoreTopics([{ topicId: 1, sourceId: "x", rank: 1 }]);
    expect(alone.score).toBe(1);
    const [three] = scoreTopics([
      { topicId: 2, sourceId: "x", rank: 1 },
      { topicId: 2, sourceId: "google_trends", rank: 3 },
      { topicId: 2, sourceId: "reddit", rank: 5 },
    ]);
    expect(three.score).toBeCloseTo(1.81, 2);
  });

  it("uses each platform's best rank once", () => {
    const [topic] = scoreTopics([
      { topicId: 1, sourceId: "bluesky", rank: 4 },
      { topicId: 1, sourceId: "bluesky", rank: 1 },
    ]);
    expect(topic.score).toBeCloseTo(0.5); // 0.5 / log2(2)
    expect(topic.platforms).toEqual([{ sourceId: "bluesky", rank: 1 }]);
  });

  it("counts corroborating platforms only alongside a lead platform", () => {
    const scores = scoreTopics([
      { topicId: 1, sourceId: "youtube", rank: 1 }, // video alone: not ranked
      { topicId: 2, sourceId: "youtube", rank: 1 },
      { topicId: 2, sourceId: "mastodon", rank: 3 },
    ]);
    expect(scores.map((s) => s.topicId)).toEqual([2]);
    expect(scores[0].score).toBeCloseTo(0.8 + 0.3 / 2);
  });

  it("orders by score, then best rank, then topic id", () => {
    const scores = scoreTopics([
      { topicId: 3, sourceId: "google_trends", rank: 2 },
      { topicId: 1, sourceId: "google_trends", rank: 1 },
      { topicId: 2, sourceId: "google_trends", rank: 2 },
    ]);
    expect(scores.map((s) => s.topicId)).toEqual([1, 2, 3]);
  });

  it("ignores sources it doesn't know", () => {
    expect(scoreTopics([{ topicId: 1, sourceId: "heartbeat", rank: 1 }])).toEqual([]);
  });
});
