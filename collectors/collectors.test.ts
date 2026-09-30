import { describe, expect, it } from "vitest";
import { bluesky } from "./bluesky";
import { googleTrends } from "./google-trends";
import { hackerNews } from "./hacker-news";
import { COLLECTORS } from "./index";
import { instagram } from "./instagram";
import { mastodon } from "./mastodon";
import { pinterest } from "./pinterest";
import { PLATFORMS } from "./registry";
import { fixture, jsonFixture, routedContext } from "./test-utils";
import { tiktok } from "./tiktok";
import { twitch } from "./twitch";
import { parseCount } from "./util";
import { x } from "./x";
import { youtube } from "./youtube";

const xml = (body: string) => new Response(body, { headers: { "Content-Type": "application/rss+xml" } });

describe("bluesky", () => {
  it("maps trends, skipping items without a display name", async () => {
    const { ctx, calls } = routedContext([
      ["https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends", () => Response.json(jsonFixture("bluesky.json"))],
    ]);
    const items = await bluesky.fetch("global", ctx);
    expect(calls[0].url).toBe("https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends?limit=25");
    expect(items).toEqual([
      {
        source: "bluesky",
        region: "global",
        rank: 1,
        title: "Example Final",
        url: "https://bsky.app/profile/did:plc:example1/feed/aaa",
        metricValue: 4200,
        metricLabel: "posts",
        matchText: ["Fans react to a close example final"],
        flags: { status: "trending" },
      },
      {
        source: "bluesky",
        region: "global",
        rank: 2,
        title: "Test Launch",
        url: "https://bsky.app/profile/did:plc:example2/feed/bbb",
        metricValue: 1300,
        metricLabel: "posts",
        flags: { status: "cooling" },
      },
      {
        source: "bluesky",
        region: "global",
        rank: 3,
        title: "Sample Awards",
        url: "https://bsky.app/profile/did:plc:example4/feed/ddd",
      },
    ]);
  });

  it("fails only this source when the schema changes", async () => {
    const { ctx } = routedContext([["https://public.api.bsky.app/", () => Response.json({ topics: [] })]]);
    await expect(bluesky.fetch("global", ctx)).rejects.toThrow();
  });

  it("has no US feed", async () => {
    const { ctx } = routedContext([]);
    await expect(bluesky.fetch("us", ctx)).rejects.toThrow("bluesky has no us feed");
  });
});

describe("google trends", () => {
  it("maps RSS items with traffic, headlines and a story or search link", async () => {
    const { ctx, calls } = routedContext([
      ["https://trends.google.com/trending/rss", () => xml(fixture("google-trends.xml"))],
    ]);
    const items = await googleTrends.fetch("us", ctx);
    expect(calls[0].url).toBe("https://trends.google.com/trending/rss?geo=US");
    expect(items).toEqual([
      {
        source: "google_trends",
        region: "us",
        rank: 1,
        title: "example storm",
        url: "https://news.example.com/storm",
        metricValue: 20000,
        metricLabel: "searches",
        matchText: ["Example storm heads east", "What to know about the example storm"],
      },
      {
        source: "google_trends",
        region: "us",
        rank: 2,
        title: "sample team & rivals",
        url: "https://www.google.com/search?q=sample%20team%20%26%20rivals",
        metricValue: 2000000,
        metricLabel: "searches",
      },
      {
        source: "google_trends",
        region: "us",
        rank: 3,
        title: "test holiday",
        url: "https://www.google.com/search?q=test%20holiday",
      },
    ]);
  });

  it("has no worldwide feed", async () => {
    const { ctx } = routedContext([]);
    await expect(googleTrends.fetch("global", ctx)).rejects.toThrow("google_trends has no global feed");
  });
});

describe("youtube", () => {
  it("sends the key in a header, never the URL, and maps videos", async () => {
    const { ctx, calls } = routedContext(
      [["https://www.googleapis.com/youtube/v3/videos", () => Response.json(jsonFixture("youtube.json"))]],
      { YOUTUBE_API_KEY: "test-key" },
    );
    const items = await youtube.fetch("us", ctx);
    expect(calls[0].url).not.toContain("test-key");
    expect(calls[0].url).toContain("chart=mostPopular");
    expect(calls[0].url).toContain("regionCode=US");
    expect((calls[0].init.headers as Record<string, string>)["X-goog-api-key"]).toBe("test-key");
    expect(items).toEqual([
      {
        source: "youtube",
        region: "us",
        rank: 1,
        title: "Invented Music Video",
        url: "https://www.youtube.com/watch?v=vid00000001",
        metricValue: 1234567,
        metricLabel: "views",
      },
      {
        source: "youtube",
        region: "us",
        rank: 2,
        title: "Made-up Game Trailer",
        url: "https://www.youtube.com/watch?v=vid00000002",
        metricValue: 89000,
        metricLabel: "views",
      },
      { source: "youtube", region: "us", rank: 3, title: "Fictional Movie Clip", url: "https://www.youtube.com/watch?v=vid00000003" },
    ]);
  });

  it("refuses to run without a key", async () => {
    const { ctx } = routedContext([]);
    await expect(youtube.fetch("us", ctx)).rejects.toThrow("YOUTUBE_API_KEY is not set");
  });
});

describe("mastodon", () => {
  it("maps tags with today's uses from the configured server", async () => {
    const { ctx, calls } = routedContext(
      [["https://mastodon.example/api/v1/trends/tags", () => Response.json(jsonFixture("mastodon.json"))]],
      { MASTODON_INSTANCE: "mastodon.example" },
    );
    const items = await mastodon.fetch("global", ctx);
    expect(calls[0].url).toBe("https://mastodon.example/api/v1/trends/tags?limit=20");
    expect(items).toEqual([
      {
        source: "mastodon",
        region: "global",
        rank: 1,
        title: "#ExampleDay",
        url: "https://mastodon.example/tags/exampleday",
        metricValue: 357,
        metricLabel: "uses today",
      },
      {
        source: "mastodon",
        region: "global",
        rank: 2,
        title: "#sampletag",
        url: "https://mastodon.example/tags/sampletag",
        metricValue: 40,
        metricLabel: "uses today",
      },
      { source: "mastodon", region: "global", rank: 3, title: "#notoday", url: "https://mastodon.example/tags/notoday" },
    ]);
  });
});

describe("hacker news", () => {
  it("fetches top stories, skips deleted, dead and missing items, and falls back to the HN link", async () => {
    const data = jsonFixture<{ topstories: number[]; items: Record<string, unknown> }>("hacker-news.json");
    const { ctx, calls } = routedContext([
      ["https://hacker-news.firebaseio.com/v0/topstories.json", () => Response.json(data.topstories)],
      [
        "https://hacker-news.firebaseio.com/v0/item/",
        (url) => Response.json(data.items[/item\/(\d+)\.json/.exec(url)![1]] ?? null),
      ],
    ]);
    const items = await hackerNews.fetch("global", ctx);
    expect(calls).toHaveLength(6);
    expect(items).toEqual([
      {
        source: "hacker_news",
        region: "global",
        rank: 1,
        title: "Show HN: An example tool",
        url: "https://example.com/tool",
        metricValue: 250,
        metricLabel: "points",
      },
      {
        source: "hacker_news",
        region: "global",
        rank: 2,
        title: "Ask HN: A sample question",
        url: "https://news.ycombinator.com/item?id=102",
        metricValue: 120,
        metricLabel: "points",
      },
    ]);
  });
});

describe("twitch", () => {
  it("gets an app token, then maps the top games", async () => {
    const data = jsonFixture<{ token: unknown; games: unknown }>("twitch.json");
    const { ctx, calls } = routedContext(
      [
        ["https://id.twitch.tv/oauth2/token", () => Response.json(data.token)],
        ["https://api.twitch.tv/helix/games/top", () => Response.json(data.games)],
      ],
      { TWITCH_CLIENT_ID: "cid", TWITCH_CLIENT_SECRET: "csecret" },
    );
    const items = await twitch.fetch("global", ctx);
    expect(calls[0].init.body).toBe("client_id=cid&client_secret=csecret&grant_type=client_credentials");
    expect(calls[1].url).toBe("https://api.twitch.tv/helix/games/top?first=25");
    const headers = calls[1].init.headers as Record<string, string>;
    expect(headers["Client-Id"]).toBe("cid");
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(items).toEqual([
      { source: "twitch", region: "global", rank: 1, title: "Example Quest", url: "https://www.twitch.tv/search?term=Example%20Quest" },
      { source: "twitch", region: "global", rank: 2, title: "Sample & Chips", url: "https://www.twitch.tv/search?term=Sample%20%26%20Chips" },
    ]);
  });

  it("reports a rejected secret without leaking it", async () => {
    const { ctx } = routedContext(
      [["https://id.twitch.tv/oauth2/token", () => Response.json({ status: 403, message: "invalid client secret" }, { status: 403 })]],
      { TWITCH_CLIENT_ID: "cid", TWITCH_CLIENT_SECRET: "csecret" },
    );
    const error = (await twitch.fetch("global", ctx).catch((e: unknown) => e)) as Error;
    expect(error.message).toBe("403 id.twitch.tv: invalid client secret");
    expect(error.message).not.toContain("csecret");
  });
});

describe("collector registry", () => {
  it("builds the phase 1 collectors plus X, TikTok, Instagram and Pinterest, each under its own id", () => {
    expect([...COLLECTORS.keys()].sort()).toEqual(
      [...PLATFORMS.filter((p) => p.phase === 1).map((p) => p.id), "x", "tiktok", "instagram", "pinterest"].sort(),
    );
    for (const [id, collector] of COLLECTORS) expect(collector.id).toBe(id);
  });
});

describe("x", () => {
  it("sends the Bearer token in a header, asks for the WOEID's list and maps trends", async () => {
    const { ctx, calls } = routedContext(
      [["https://api.x.com/2/trends/by/woeid/", () => Response.json(jsonFixture("x.json"))]],
      { X_BEARER_TOKEN: "x-token" },
    );
    const items = await x.fetch("us", ctx);
    expect(calls[0].url).toBe("https://api.x.com/2/trends/by/woeid/23424977?max_trends=20&trend.fields=trend_name%2Ctweet_count");
    expect(calls[0].url).not.toContain("x-token");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer x-token");
    expect(items).toEqual([
      {
        source: "x",
        region: "us",
        rank: 1,
        title: "#ExampleFinal",
        url: "https://x.com/search?q=%23ExampleFinal&src=trend_click",
        metricValue: 125000,
        metricLabel: "posts",
      },
      { source: "x", region: "us", rank: 2, title: "Sample Senator", url: "https://x.com/search?q=Sample%20Senator&src=trend_click" },
      {
        source: "x",
        region: "us",
        rank: 3,
        title: "Test Launch",
        url: "https://x.com/search?q=Test%20Launch&src=trend_click",
        metricValue: 8200,
        metricLabel: "posts",
      },
    ]);
  });

  it("uses WOEID 1 for the worldwide list", async () => {
    const { ctx, calls } = routedContext([["https://api.x.com/", () => Response.json({ data: [] })]], { X_BEARER_TOKEN: "t" });
    await x.fetch("global", ctx);
    expect(calls[0].url).toContain("/woeid/1?");
  });

  it("reports X's error instead of an empty list, and a payment problem by status", async () => {
    const { ctx } = routedContext(
      [["https://api.x.com/", () => Response.json({ errors: [{ title: "Invalid Request", detail: "bad woeid" }] })]],
      { X_BEARER_TOKEN: "t" },
    );
    await expect(x.fetch("global", ctx)).rejects.toThrow("no trends: Invalid Request");
    const unpaid = routedContext(
      [["https://api.x.com/", () => Response.json({ title: "CreditsDepleted" }, { status: 402, statusText: "Payment Required" })]],
      { X_BEARER_TOKEN: "t" },
    );
    await expect(x.fetch("global", unpaid.ctx)).rejects.toThrow("402 api.x.com");
  });
});

describe("tiktok", () => {
  const data = jsonFixture<{ run: unknown; items: unknown }>("tiktok.json");
  const routes = (): [string, (url: string, init: RequestInit) => Response][] => [
    ["https://api.apify.com/v2/acts/data_xplorer~tiktok-trends/runs/last", () => Response.json(data.run)],
    ["https://api.apify.com/v2/datasets/ds456/items", () => Response.json(data.items)],
  ];

  it("reads the latest successful Apify run's US hashtags in rank order", async () => {
    const { ctx, calls } = routedContext(routes(), { APIFY_TOKEN: "apify-token" });
    ctx.now = new Date("2026-10-08T12:07:00Z");
    const items = await tiktok.fetch("us", ctx);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.apify.com/v2/acts/data_xplorer~tiktok-trends/runs/last?status=SUCCEEDED",
      "https://api.apify.com/v2/datasets/ds456/items?clean=true",
    ]);
    expect(calls.every((c) => (c.init.headers as Record<string, string>).Authorization === "Bearer apify-token")).toBe(true);
    expect(calls.some((c) => c.url.includes("apify-token"))).toBe(false);
    expect(items).toEqual([
      {
        source: "tiktok",
        region: "us",
        rank: 1,
        title: "#examplechallenge",
        url: "https://www.tiktok.com/tag/examplechallenge",
        metricValue: 98000000,
        metricLabel: "views",
        flags: { direction: "up" },
        series: [
          { day: "2026-10-06", value: 20 },
          { day: "2026-10-07", value: 100 },
        ],
      },
      {
        source: "tiktok",
        region: "us",
        rank: 2,
        title: "#sampledance",
        url: "https://www.tiktok.com/tag/sampledance",
        metricValue: 5100,
        metricLabel: "posts",
        flags: { direction: "down" },
        // Dated by timestamp when `date` is missing, sorted, and a point with an unreadable date dropped.
        series: [
          { day: "2026-10-07", value: 64.5 },
          { day: "2026-10-08", value: 100 },
        ],
      },
      // An unknown direction and a missing curve leave both fields out.
      { source: "tiktok", region: "us", rank: 3, title: "#testtrend", url: "https://www.tiktok.com/tag/testtrend" },
    ]);
  });

  it("fails when the latest successful run is too old", async () => {
    const { ctx } = routedContext(routes(), { APIFY_TOKEN: "t" });
    ctx.now = new Date("2026-10-10T12:00:00Z");
    await expect(tiktok.fetch("us", ctx)).rejects.toThrow("latest TikTok run finished 54 h ago; check the Apify schedule");
  });

  it("fails without APIFY_TOKEN before calling Apify", async () => {
    const { ctx, calls } = routedContext(routes());
    await expect(tiktok.fetch("us", ctx)).rejects.toThrow("APIFY_TOKEN is not set");
    expect(calls).toHaveLength(0);
  });
});

describe("instagram", () => {
  const data = jsonFixture<{ run: unknown; items: unknown }>("instagram.json");
  const routes = (): [string, (url: string, init: RequestInit) => Response][] => [
    ["https://api.apify.com/v2/acts/s-r~instagram-trending-scraper/runs/last", () => Response.json(data.run)],
    ["https://api.apify.com/v2/datasets/ds012/items", () => Response.json(data.items)],
  ];

  it("reads the latest successful Apify run's topics in rank order", async () => {
    const { ctx, calls } = routedContext(routes(), { APIFY_TOKEN: "apify-token" });
    ctx.now = new Date("2026-10-08T12:07:00Z");
    const items = await instagram.fetch("global", ctx);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.apify.com/v2/acts/s-r~instagram-trending-scraper/runs/last?status=SUCCEEDED",
      "https://api.apify.com/v2/datasets/ds012/items?clean=true",
    ]);
    expect(calls.every((c) => (c.init.headers as Record<string, string>).Authorization === "Bearer apify-token")).toBe(true);
    expect(calls.some((c) => c.url.includes("apify-token"))).toBe(false);
    expect(items).toEqual([
      {
        source: "instagram",
        region: "global",
        rank: 1,
        title: "example final",
        url: "https://www.instagram.com/popular/example-final/",
        metricValue: 1540000,
        metricLabel: "posts",
      },
      {
        source: "instagram",
        region: "global",
        rank: 2,
        title: "sample festival",
        url: "https://www.instagram.com/popular/sample-festival/",
        metricValue: 41000,
        metricLabel: "posts",
      },
      // An unexpected slug is never put into a URL path; the topic is searched instead.
      {
        source: "instagram",
        region: "global",
        rank: 3,
        title: "Test Launch",
        url: "https://www.instagram.com/explore/search/keyword/?q=Test%20Launch",
      },
    ]);
  });

  it("has only a worldwide list", async () => {
    const { ctx } = routedContext(routes(), { APIFY_TOKEN: "t" });
    await expect(instagram.fetch("us", ctx)).rejects.toThrow("instagram has no us feed");
  });

  it("fails when the latest successful run is too old", async () => {
    const { ctx } = routedContext(routes(), { APIFY_TOKEN: "t" });
    ctx.now = new Date("2026-10-09T06:00:00Z");
    await expect(instagram.fetch("global", ctx)).rejects.toThrow("latest Instagram run finished 24 h ago; check the Apify schedule");
  });
});

describe("pinterest", () => {
  const data = jsonFixture<{ run: unknown; items: unknown }>("pinterest.json");
  const routes = (): [string, (url: string, init: RequestInit) => Response][] => [
    ["https://api.apify.com/v2/acts/automation-lab~pinterest-trends-scraper/runs/last", () => Response.json(data.run)],
    ["https://api.apify.com/v2/datasets/ds678/items", () => Response.json(data.items)],
  ];

  it("reads the latest successful Apify run's growing US keywords in rank order", async () => {
    const { ctx, calls } = routedContext(routes(), { APIFY_TOKEN: "apify-token" });
    ctx.now = new Date("2026-10-06T12:07:00Z");
    const items = await pinterest.fetch("us", ctx);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.apify.com/v2/acts/automation-lab~pinterest-trends-scraper/runs/last?status=SUCCEEDED",
      "https://api.apify.com/v2/datasets/ds678/items?clean=true",
    ]);
    expect(calls.every((c) => (c.init.headers as Record<string, string>).Authorization === "Bearer apify-token")).toBe(true);
    expect(items).toEqual([
      {
        source: "pinterest",
        region: "us",
        rank: 1,
        title: "example wallpaper",
        url: "https://trends.pinterest.com/detail/?terms=example%20wallpaper&country=US",
        metricValue: 83,
        metricLabel: "search index",
      },
      {
        source: "pinterest",
        region: "us",
        rank: 2,
        title: "sample porch decor",
        url: "https://trends.pinterest.com/detail/?terms=sample%20porch%20decor&country=US",
        metricValue: 23,
        metricLabel: "search index",
      },
      // Other countries and trend types are skipped; a missing count leaves the metric out.
      {
        source: "pinterest",
        region: "us",
        rank: 3,
        title: "test crafts & kids",
        url: "https://trends.pinterest.com/detail/?terms=test%20crafts%20%26%20kids&country=US",
      },
    ]);
  });

  it("fails when the twice-weekly schedule has stopped", async () => {
    const { ctx } = routedContext(routes(), { APIFY_TOKEN: "t" });
    ctx.now = new Date("2026-10-13T07:00:00Z");
    await expect(pinterest.fetch("us", ctx)).rejects.toThrow("latest Pinterest run finished 192 h ago; check the Apify schedule");
  });
});

describe("parseCount", () => {
  it("reads counts with separators, suffixes and plus signs", () => {
    expect(parseCount("20,000+")).toBe(20000);
    expect(parseCount("1.5M+")).toBe(1500000);
    expect(parseCount("200K")).toBe(200000);
    expect(parseCount("357")).toBe(357);
    expect(parseCount(42)).toBe(42);
    expect(parseCount("lots")).toBeUndefined();
    expect(parseCount(undefined)).toBeUndefined();
  });
});
