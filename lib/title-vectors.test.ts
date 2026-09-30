import { describe, expect, it } from "vitest";
import type { Embedder } from "@/lib/embed";
import { embedTitles } from "./title-vectors";

// A stand-in model: 384 dimensions, the text's length in the first one.
const lengthEmbedder: Embedder = async (texts) =>
  texts.map((text) => {
    const vector = new Array(384).fill(0);
    vector[0] = text.length;
    return vector;
  });

describe("embedTitles", () => {
  it("filters like the pipeline, embeds the kept titles' matching text and indexes them", async () => {
    const result = await embedTitles(
      [
        { id: "a", source: "mastodon", title: "#WorldSeries" },
        { id: "b", source: "x", title: "東京オリンピック" },
        { id: "c", source: "mastodon", title: "#MondayMotivation" },
        { id: "d", source: "bluesky", title: "Fat Bear Week" },
      ],
      new Set(["mondaymotivation"]),
      lengthEmbedder,
    );
    expect(result.rows).toEqual([
      { id: "a", kept: true, index: 0 },
      { id: "b", kept: false, reason: "non-latin" },
      { id: "c", kept: false, reason: "blocklist" },
      { id: "d", kept: true, index: 1 },
    ]);
    expect(result.dimensions).toBe(384);
    expect(result.vectors).toHaveLength(2 * 384);
    expect(result.vectors[0]).toBe("world series".length); // hashtags split and lowercased, as in matching
    expect(result.vectors[384]).toBe("fat bear week".length);
  });

  it("needs no model call when nothing is kept", async () => {
    const never: Embedder = async () => {
      throw new Error("should not embed");
    };
    const result = await embedTitles([{ id: "a", source: "x", title: "   " }], new Set(), never);
    expect(result.rows).toEqual([{ id: "a", kept: false, reason: "empty" }]);
    expect(result.vectors).toHaveLength(0);
  });
});
