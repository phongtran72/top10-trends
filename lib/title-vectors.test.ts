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
      { id: "a", kept: true, index: 0, text: "world series" },
      { id: "b", kept: false, reason: "non-latin" },
      { id: "c", kept: false, reason: "blocklist" },
      { id: "d", kept: true, index: 1, text: "fat bear week" },
    ]);
    expect(result.dimensions).toBe(384);
    expect(result.vectors).toHaveLength(2 * 384);
    expect(result.vectors[0]).toBe("world series".length); // hashtags split and lowercased, as in matching
    expect(result.vectors[384]).toBe("fat bear week".length);
  });

  it("keeps a hashtag whole when its group's titles use it as a plain word, like the rank step", async () => {
    const rows = [{ id: "a", source: "mastodon", title: "#flydubai", group: "22" }];
    const withBrand = { "22": [{ source: "bluesky", title: "Flydubai flight diverts to Saudi Arabia" }] };
    const without = { "22": [{ source: "bluesky", title: "Fat Bear Week" }] };
    expect((await embedTitles(rows, new Set(), lengthEmbedder, withBrand)).vectors[0]).toBe("flydubai".length);
    expect((await embedTitles(rows, new Set(), lengthEmbedder, without)).vectors[0]).toBe("fly dubai".length);
  });

  it("without groups, the kept rows' own titles give the words to keep", async () => {
    const rows = [
      { id: "a", source: "mastodon", title: "#flydubai" },
      { id: "b", source: "bluesky", title: "Flydubai flight diverts to Saudi Arabia" },
    ];
    expect((await embedTitles(rows, new Set(), lengthEmbedder)).vectors[0]).toBe("flydubai".length);
  });

  it("embeds a row's stored match text with its title, as the rank step does", async () => {
    const result = await embedTitles(
      [
        { id: "a", source: "google_trends", title: "lito", matchText: ["Lito Sousa dies", "Palmeiras fan mourned", "a third headline"] },
        { id: "b", source: "google_trends", title: "lito", matchText: null },
        { id: "c", source: "google_trends", title: "lito", matchText: [] },
      ],
      new Set(),
      lengthEmbedder,
    );
    expect(result.rows.map((row) => row.text)).toEqual(["lito. lito sousa dies. palmeiras fan mourned", "lito", "lito"]);
  });

  it("reads the match text in the filters and in the words that keep a hashtag whole", async () => {
    const rows = [
      { id: "a", source: "bluesky", title: "Flug umgeleitet", matchText: ["Ein Flug von Flydubai wurde nach Riad umgeleitet, berichten Medien"] },
      { id: "b", source: "mastodon", title: "#flydubai", group: "22" },
    ];
    const groups = { "22": [{ source: "google_trends", title: "flight diverted", matchText: ["Flydubai flight diverts to Saudi Arabia"] }] };
    const result = await embedTitles(rows, new Set(), lengthEmbedder, groups);
    expect(result.rows[0]).toMatchObject({ kept: false, reason: "language" }); // the description gives the language away
    expect(result.rows[1].text).toBe("flydubai"); // kept whole by a headline in its group
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
