import { describe, expect, it } from "vitest";
import { normalize, prettyLabel, slugify, splitHashtag } from "./text";

describe("normalize", () => {
  it.each([
    ["#WorldSeries2026", "world series 2026"],
    ["#GRAMMYs", "grammys"],
    ["#NBAFinals", "nba finals"],
    ["#F1", "f1"],
    ["#ConfusedSongsOrPoems", "confused songs or poems"],
    ["#dogs_of_mastodon", "dogs of mastodon"],
    ["🔴 LIVE | Game Night 🎮", "live | game night"],
    ["🎉🎉🎉", ""],
    ["Read this https://example.com/a?b=1 now", "read this now"],
    ["dodgers vs yankees", "dodgers vs yankees"],
    ["  Already   clean phrase ", "already clean phrase"],
    // One lowercase run is split into listed English words (lib/segment.ts).
    ["#nationalcoffeeday", "national coffee day"],
    ["#firstdayoffall", "first day of fall"],
    ["#nationalcoffeeday2026", "national coffee day 2026"],
    ["aircrash", "air crash"],
    ["#fediverse", "fediverse"],
    ["rihanna", "rihanna"],
    ["photography tips", "photography tips"],
  ])("%s → %s", (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });
});

describe("prettyLabel", () => {
  it.each([
    ["#WorldSeries2026", "World Series 2026"],
    ["#GRAMMYs", "GRAMMYs"],
    ["#MeerMittwoch", "Meer Mittwoch"],
    ["dodgers vs yankees", "dodgers vs yankees"],
    ["Man City charges case 🏆", "Man City charges case"],
    ["#jacksmith", "jack smith"],
    ["WorldSeries", "World Series"],
  ])("%s → %s", (input, expected) => {
    expect(prettyLabel(input)).toBe(expected);
  });
});

describe("splitHashtag", () => {
  it("keeps short letter-digit tokens whole", () => {
    expect(splitHashtag("3D")).toBe("3D");
    expect(splitHashtag("COVID19")).toBe("COVID 19");
    expect(splitHashtag("2026Election")).toBe("2026 Election");
  });
});

describe("slugify", () => {
  it("makes short URL-safe slugs", () => {
    expect(slugify("#WorldSeries2026!")).toBe("world-series-2026");
    expect(slugify("Café Société")).toBe("cafe-societe");
    expect(slugify("🎉")).toBe("topic");
    expect(slugify("a".repeat(80))).toHaveLength(60);
  });
});
