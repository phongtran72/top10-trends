import { describe, expect, it } from "vitest";
import { cosine, createEmbedder, embeddingText, unitVector } from "./embed";

describe("embeddingText", () => {
  it("joins the normalized title and up to two headlines", () => {
    expect(
      embeddingText({ title: "#WorldSeries", matchText: ["Dodgers win Game 4", "What to know", "A third headline"] }),
    ).toBe("world series. dodgers win game 4. what to know");
    expect(embeddingText({ title: "flood watch" })).toBe("flood watch");
  });
});

describe("vector helpers", () => {
  it("computes cosine similarity and unit vectors", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 1], [2, 2])).toBeCloseTo(1);
    expect(cosine([0, 0], [1, 0])).toBe(0);
    expect(unitVector([3, 4])).toEqual([0.6, 0.8]);
  });
});

// Downloads the real model, so it only runs when asked: RUN_MODEL_TESTS=1 npm test.
describe.runIf(process.env.RUN_MODEL_TESTS === "1")("all-MiniLM-L6-v2", () => {
  it("puts the same story close together and unrelated text far apart", async () => {
    const embed = await createEmbedder();
    const [series, headline, phone] = await embed([
      "world series",
      "dodgers win game 4 of the world series",
      "new phone launch event",
    ]);
    expect(series).toHaveLength(384);
    expect(cosine(series, headline)).toBeGreaterThan(cosine(series, phone));
  }, 120_000);
});
