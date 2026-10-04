import { describe, expect, it } from "vitest";
import { getSource } from "@/collectors/registry";
import { inView } from "@/config/ranking";
import { feedQuery, parseFeed, parseView, viewQuery } from "./view";

describe("views", () => {
  it("reads the view from ?region=, falling back to Global", () => {
    expect(parseView("us")).toBe("us");
    expect(parseView("US")).toBe("us");
    expect(parseView(["us", "global"])).toBe("us");
    expect(parseView("global")).toBe("global");
    expect(parseView("gb")).toBe("global"); // a feed, not a view
    expect(parseView(undefined)).toBe("global");
  });

  it("leaves the default view out of links", () => {
    expect(viewQuery("global")).toBe("");
    expect(viewQuery("us")).toBe("?region=us");
  });

  it("puts every list in Global, and only the US and worldwide lists, without X's Worldwide list, in US", () => {
    const lists = [
      ["x", "us"],
      ["x", "global"],
      ["google_trends", "us"],
      ["google_trends", "gb"],
      ["youtube", "au"],
      ["bluesky", "global"],
      ["pinterest", "us"],
    ] as const;
    expect(lists.filter(([source, region]) => inView("global", source, region))).toHaveLength(lists.length);
    expect(lists.filter(([source, region]) => inView("us", source, region))).toEqual([
      ["x", "us"],
      ["google_trends", "us"],
      ["bluesky", "global"],
      ["pinterest", "us"],
    ]);
  });
});

describe("platform feeds", () => {
  it("reads a platform page's feed from ?region=, falling back to the feed the page shows first", () => {
    expect(parseFeed(getSource("google_trends"), "gb")).toBe("gb");
    expect(parseFeed(getSource("google_trends"), undefined)).toBe("us");
    expect(parseFeed(getSource("google_trends"), "global")).toBe("us"); // Google has no worldwide feed
    expect(parseFeed(getSource("x"), undefined)).toBe("us");
    expect(parseFeed(getSource("x"), "global")).toBe("global");
    expect(parseFeed(getSource("bluesky"), "us")).toBe("global");
  });

  it("links to a feed, leaving the first one out of the URL", () => {
    expect(feedQuery(getSource("google_trends"), "us")).toBe("");
    expect(feedQuery(getSource("google_trends"), "gb")).toBe("?region=gb");
    expect(feedQuery(getSource("x"), "global")).toBe("?region=global");
  });
});
