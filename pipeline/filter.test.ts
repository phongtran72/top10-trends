import { describe, expect, it } from "vitest";
import type { TrendItem } from "@/collectors/types";
import { checkItem, compactText, filterItems, latinShare, loadBlocklist, parseBlocklist } from "./filter";

const blocklist = parseBlocklist("# comment\nmondaymotivation\nCaturday\n\n  nowplaying  ");

function item(title: string, extra: Partial<TrendItem> = {}): TrendItem {
  return { source: "bluesky", region: "global", rank: 1, title, url: "https://example.com", ...extra };
}

const reason = (title: string, extra?: Partial<TrendItem>) => checkItem(item(title, extra), blocklist)?.reason ?? null;

describe("filters", () => {
  it("keeps ordinary English items, names and games", () => {
    for (const title of ["Flood watch", "Man City charges case", "novak djokovic", "VALORANT", "#WorldSeries2026", "us-iran"]) {
      expect(reason(title)).toBeNull();
    }
  });

  it("drops items that are empty after cleaning", () => {
    expect(reason("🎉🎉")).toBe("empty");
  });

  it("drops NSFW posts", () => {
    expect(reason("Some post", { flags: { nsfw: true } })).toBe("nsfw");
  });

  it("drops Bluesky trends that are cooling or stale, and keeps the rest", () => {
    expect(checkItem(item("Topic", { flags: { status: "cooling" } }), blocklist)).toEqual({ reason: "status", detail: "cooling" });
    expect(reason("Topic", { flags: { status: "Stale" } })).toBe("status");
    expect(reason("Topic", { flags: { status: "trending" } })).toBeNull();
    expect(reason("Topic", { flags: { status: "saturating" } })).toBeNull();
  });

  it("drops blocklisted evergreen tags whatever their case or spacing", () => {
    expect(reason("#MondayMotivation")).toBe("blocklist");
    expect(reason("#caturday")).toBe("blocklist");
    expect(reason("Now Playing")).toBe("blocklist");
    expect(reason("Monday Motivation quotes")).toBeNull();
  });

  it("drops profanity", () => {
    expect(reason("what the fuck")).toBe("profanity");
    expect(reason("Scunthorpe United")).toBeNull();
  });

  it("drops non-Latin scripts", () => {
    expect(reason("東京オリンピック")).toBe("non-latin");
    expect(reason("Новости дня")).toBe("non-latin");
  });

  it("drops confident non-English text and lets unsure text pass", () => {
    expect(checkItem(item("el clasico hoy"), blocklist)).toEqual({ reason: "language", detail: "es" });
    expect(reason("Deutschlandticket")).toBe("language");
    expect(reason("Schmitt remarks on Jack Smith")).toBeNull();
  });

  it("uses headlines to confirm English", () => {
    expect(
      reason("savannah james", { source: "google_trends", matchText: ["Savannah James shares a photo with her family"] }),
    ).toBeNull();
  });

  it("splits a list into kept and dropped items", () => {
    const result = filterItems([item("Flood watch"), item("#caturday"), item("Topic", { flags: { status: "cooling" } })], blocklist);
    expect(result.kept.map((i) => i.title)).toEqual(["Flood watch"]);
    expect(result.dropped.map((d) => [d.item.title, d.reason])).toEqual([
      ["#caturday", "blocklist"],
      ["Topic", "status"],
    ]);
  });
});

describe("helpers", () => {
  it("compacts text for blocklist comparison", () => {
    expect(compactText("#Monday Motivation!")).toBe("mondaymotivation");
  });

  it("measures the Latin share of letters", () => {
    expect(latinShare("abc")).toBe(1);
    expect(latinShare("2026")).toBe(1);
    expect(latinShare("日本")).toBe(0);
  });

  it("loads config/blocklist.txt", () => {
    const terms = loadBlocklist();
    expect(terms.has("mondaymotivation")).toBe(true);
    expect([...terms].some((t) => t.startsWith("#"))).toBe(false);
  });

  it("blocks the greetings that trend on X every day, but not a real holiday", () => {
    const terms = loadBlocklist();
    const blocked = (title: string) => checkItem(item(title), terms)?.reason === "blocklist";
    expect(["Good Thursday", "Happy New Month", "#HappySunday", "Hello October", "hellooctober"].every(blocked)).toBe(true);
    expect(blocked("Good Friday")).toBe(false);
    expect(blocked("Happy New Year")).toBe(false);
  });
});
