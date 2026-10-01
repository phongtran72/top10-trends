import { describe, expect, it } from "vitest";
import { loadWords, parseWords, segmentRun, setSegmentation } from "./segment";

// A tiny synthetic dictionary: word and count, like config/words-en.txt.
const tiny = parseWords(["the 5000", "of 4000", "off 3000", "all 3000", "day 2900", "first 800", "fall 300", "coffee 200", "national 100", "ofa 5", "", "'s 99", "Bad 7"].join("\n"));

describe("segmentRun", () => {
  it("splits a run into listed words", () => {
    expect(segmentRun("nationalcoffeeday", tiny)).toBe("national coffee day");
  });

  it("prefers content words over short ones", () => {
    expect(segmentRun("firstdayoffall", tiny)).toBe("first day of fall");
  });

  it("keeps a run whole when it can't be split into listed words, or is short, or isn't lowercase letters", () => {
    expect(segmentRun("authentik", tiny)).toBe("authentik");
    expect(segmentRun("theday", tiny)).toBe("the day");
    expect(segmentRun("thed", tiny)).toBe("thed");
    expect(segmentRun("Nationalday", tiny)).toBe("Nationalday");
  });

  it("ignores rare three-letter entries and lines that aren't lowercase words", () => {
    expect(tiny.cost.has("ofa")).toBe(false);
    expect(tiny.cost.has("'s")).toBe(false);
    expect(tiny.cost.has("Bad")).toBe(false);
  });

  it("can be turned off for replay comparisons", () => {
    setSegmentation(false);
    try {
      expect(segmentRun("nationalcoffeeday", tiny)).toBe("nationalcoffeeday");
    } finally {
      setSegmentation(true);
    }
  });
});

describe("config/words-en.txt", () => {
  it.each([
    ["citytastetest", "city taste test"],
    ["thelifeofashowgirl", "the life of a showgirl"],
    ["harvestmoon", "harvest moon"],
    ["jacksmith", "jack smith"],
    ["blacklivesmatter", "black lives matter"],
    ["fediverse", "fediverse"],
    ["broski", "broski"],
    ["floresamarillas", "floresamarillas"],
  ])("%s → %s", (run, expected) => {
    expect(segmentRun(run, loadWords())).toBe(expected);
  });
});
