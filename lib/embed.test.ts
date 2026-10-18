import { describe, expect, it } from "vitest";
import { cosine, createEmbedder, describeEmbedder, embeddingText, matryoshka, PROBE_TEXT, unitVector } from "./embed";

describe("embeddingText", () => {
  it("joins the normalized title and up to two headlines", () => {
    expect(
      embeddingText({ title: "#WorldSeries", matchText: ["Dodgers win Game 4", "What to know", "A third headline"] }),
    ).toBe("world series. dodgers win game 4. what to know");
    expect(embeddingText({ title: "flood watch" })).toBe("flood watch");
    expect(embeddingText({ title: "#flydubai" }, { keep: new Set(["flydubai"]) })).toBe("flydubai");
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

describe("matryoshka", () => {
  it("layer-norms the full vector, keeps the first dimensions and scales to unit length", () => {
    // mean 2.5, std √1.25: the first two become −1.34 and −0.45, then unit length.
    const [a, b] = matryoshka([1, 2, 3, 4], 2);
    expect(a).toBeCloseTo(-0.9487, 4);
    expect(b).toBeCloseTo(-0.3162, 4);
    expect(matryoshka(Array.from({ length: 768 }, (_, i) => Math.sin(i)))).toHaveLength(384);
  });
});

describe("describeEmbedder", () => {
  it("names the machine and gives a fixed text's vector, so runs can be compared", async () => {
    const asked: string[] = [];
    const embed = async (texts: readonly string[]) => {
      asked.push(...texts);
      return [[0.1234564, -0.5, 0.25, 0.75]];
    };
    const line = await describeEmbedder(embed, "Test CPU 9000");
    expect(asked).toEqual([PROBE_TEXT]);
    expect(line).toMatch(/^embedder: \w+ on Test CPU 9000; probe [0-9a-f]{8} \(0\.123456, -0\.500000, 0\.250000\)$/);
    // The same vector gives the same line; a vector one step away does not.
    expect(await describeEmbedder(embed, "Test CPU 9000")).toBe(line);
    expect(await describeEmbedder(async () => [[0.1234564, -0.5, 0.25, 0.7500001]], "Test CPU 9000")).not.toBe(line);
  });
});

// Downloads the real model, so it only runs when asked: RUN_MODEL_TESTS=1 npm test.
describe.runIf(process.env.RUN_MODEL_TESTS === "1")("nomic-embed-text-v1.5", () => {
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
