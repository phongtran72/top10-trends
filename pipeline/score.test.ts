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

  it("lets X's Worldwide list back up a topic another lead list has, but never lead one or outrank X's US list", () => {
    const scores = scoreTopics([
      { topicId: 1, sourceId: "x", rank: 1, region: "global" }, // Worldwide only: not ranked
      { topicId: 2, sourceId: "x", rank: 2, region: "global" },
      { topicId: 2, sourceId: "x", rank: 5, region: "us" }, // the US list has it, so its rank is X's rank
      { topicId: 3, sourceId: "x", rank: 1, region: "global" },
      { topicId: 3, sourceId: "mastodon", rank: 1, region: "global" },
      { topicId: 4, sourceId: "x", rank: 1, region: "global" },
      { topicId: 4, sourceId: "youtube", rank: 1, region: "us" }, // a video is no confirmation
    ]);
    expect(scores.map((s) => s.topicId)).toEqual([3, 2]);
    expect(scores[0].score).toBeCloseTo(1.3);
    expect(scores[1].score).toBeCloseTo(1 / Math.log2(6));
    expect(scores[1].platforms).toEqual([{ sourceId: "x", rank: 5 }]);
    expect(scores[0].platforms).toEqual([{ sourceId: "x", rank: 1 }, { sourceId: "mastodon", rank: 1 }]);
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
