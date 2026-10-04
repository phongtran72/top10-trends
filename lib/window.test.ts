import { describe, expect, it } from "vitest";
import { mergeWindows, rankWindow } from "./window";

const at = (hh: string) => `2026-09-30T${hh}:07:00.000Z`;

describe("rankWindow", () => {
  it("ranks the window by search volume, not by feed position", () => {
    const ranked = rankWindow([
      { title: "newest small", metricValue: 1000, rank: 1, fetchedAt: at("22") },
      { title: "big earlier", metricValue: 50000, rank: 7, fetchedAt: at("22") },
      { title: "mid", metricValue: 5000, rank: 2, fetchedAt: at("21") },
    ]);
    expect(ranked.map((i) => i.title)).toEqual(["big earlier", "mid", "newest small"]);
  });

  it("keeps each title once, at its latest sighting", () => {
    const ranked = rankWindow([
      { title: "Astros", metricValue: 20000, rank: 1, fetchedAt: at("20") },
      { title: "astros ", metricValue: 50000, rank: 7, fetchedAt: at("22") },
      { title: "other", metricValue: 30000, rank: 2, fetchedAt: at("21") },
    ]);
    expect(ranked).toEqual([
      { title: "astros ", metricValue: 50000, rank: 7, fetchedAt: at("22") },
      { title: "other", metricValue: 30000, rank: 2, fetchedAt: at("21") },
    ]);
  });

  it("breaks ties by the newer sighting, then feed position; a missing volume goes last", () => {
    const ranked = rankWindow([
      { title: "a", metricValue: 1000, rank: 3, fetchedAt: at("21") },
      { title: "b", metricValue: 1000, rank: 4, fetchedAt: at("22") },
      { title: "c", metricValue: 1000, rank: 2, fetchedAt: at("22") },
      { title: "d", metricValue: null, rank: 1, fetchedAt: at("22") },
    ]);
    expect(ranked.map((i) => i.title)).toEqual(["c", "b", "a", "d"]);
  });
});

describe("mergeWindows", () => {
  it("ranks several feeds as one list: a title's volume is the sum of its feeds' volumes", () => {
    const us = { title: "usa vs mexico", metricValue: 2000, rank: 2, fetchedAt: at("22") };
    const gb = { title: "USA vs Mexico", metricValue: 5000, rank: 1, fetchedAt: at("22") };
    const big = { title: "sydney sweeney", metricValue: 5000, rank: 1, fetchedAt: at("22") };
    const small = { title: "leafs score", metricValue: 1000, rank: 2, fetchedAt: at("21") };
    const places = mergeWindows([us, gb, big, small]);
    expect([us, gb, big, small].map((row) => places.get(row))).toEqual([
      { rank: 1, metricValue: 7000 },
      { rank: 1, metricValue: 7000 },
      { rank: 2, metricValue: 5000 },
      { rank: 3, metricValue: 1000 },
    ]);
  });

  it("breaks ties by the newer sighting, then the better feed place, then the title; no volume goes last", () => {
    const rows = [
      { title: "b", metricValue: null, rank: 1, fetchedAt: at("22") },
      { title: "a", metricValue: null, rank: 1, fetchedAt: at("22") },
      { title: "c", metricValue: 100, rank: 9, fetchedAt: at("20") },
      { title: "d", metricValue: null, rank: 2, fetchedAt: at("22") },
    ];
    const places = mergeWindows(rows);
    expect(rows.map((row) => places.get(row)?.rank)).toEqual([3, 2, 1, 4]);
  });
});
