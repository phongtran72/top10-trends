import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc } from "drizzle-orm";
import type { SourceId } from "@/collectors/registry";
import type { Collector } from "@/collectors/types";
import { fetchRuns, rankings, sources, topics, trendItems } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { HttpError } from "@/lib/http";
import { parseArgs, runPipeline } from "./main";
import { wordEmbedder } from "./test-embedder";

// Tests never load the real model or touch the network.
const offline = { createEmbedder: async () => wordEmbedder, blocklist: new Set<string>() };

let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

function capture() {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line) };
}

const sessionUrl = "postgresql://postgres.abc:pw@aws-0-us-east-2.pooler.supabase.com:5432/postgres";

// Fake collectors: Bluesky returns two items, Mastodon fails, YouTube needs a
// key that the tests don't set, so it is skipped.
const fakeCollectors: ReadonlyMap<SourceId, Collector> = new Map<SourceId, Collector>([
  [
    "bluesky",
    {
      id: "bluesky",
      fetch: async (region) => [
        { source: "bluesky", region, rank: 1, title: "Example Final", url: "https://bsky.app/a", metricValue: 10, metricLabel: "posts" },
        { source: "bluesky", region, rank: 2, title: "Test Launch", url: "https://bsky.app/b" },
      ],
    },
  ],
  [
    "mastodon",
    {
      id: "mastodon",
      fetch: async () => {
        throw new HttpError(503, "mastodon.social", "Service Unavailable");
      },
    },
  ],
  ["youtube", { id: "youtube", fetch: async () => [] }],
]);

describe("parseArgs", () => {
  it("accepts --dry-run and --include-paid and rejects anything else", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, includePaid: false });
    expect(parseArgs(["--dry-run", "--include-paid"])).toEqual({ dryRun: true, includePaid: true });
    expect(() => parseArgs(["--dryrun"])).toThrow(/unknown argument/);
  });
});

describe("runPipeline", () => {
  it("dry run prints the plan and each list, and never opens the database", async () => {
    const out = capture();
    await runPipeline(["--dry-run"], { DISABLED_SOURCES: "tiktock" }, {
      openDb: () => {
        throw new Error("should not open the database");
      },
      log: out.log,
      collectors: fakeCollectors,
      ...offline,
    });
    expect(out.lines[0]).toBe("warning: DISABLED_SOURCES has unknown ids: tiktock");
    expect(out.lines).toContain("sources:");
    expect(out.lines.some((l) => /^bluesky \(global\): ok, 2 items in \d+ ms$/.test(l))).toBe(true);
    expect(out.lines).toContain("   1. Example Final · 10 posts  https://bsky.app/a");
    expect(out.lines).toContain("mastodon (global): error: 503 mastodon.social: Service Unavailable");
    expect(out.lines).toContain("youtube (us): skipped: missing YOUTUBE_API_KEY");
    expect(out.lines.at(-1)).toMatch(
      /^dry run: nothing written, 1 lists ok, 1 failed, 4 skipped, 8 sources not built yet \(\d+ ms\)$/,
    );
  });

  it("full run writes sources, one fetch_runs row per list, the items and the heartbeat", async () => {
    const out = capture();
    let closed = false;
    const start = new Date("2026-09-30T12:07:00Z");
    await runPipeline([], { SESSION_DATABASE_URL: sessionUrl }, {
      openDb: (url) => {
        expect(url).toBe(sessionUrl);
        return { db: t.db, close: async () => void (closed = true) };
      },
      log: out.log,
      now: () => start,
      collectors: fakeCollectors,
      ...offline,
    });

    expect(closed).toBe(true);
    expect(await t.db.select().from(sources)).toHaveLength(12);
    const runs = await t.db.select().from(fetchRuns).orderBy(asc(fetchRuns.id));
    expect(runs.map((r) => [r.sourceId, r.region, r.status, r.itemCount, r.error])).toEqual([
      ["bluesky", "global", "ok", 2, null],
      ["mastodon", "global", "error", 0, "503 mastodon.social: Service Unavailable"],
      ["youtube", "us", "skipped", 0, "missing YOUTUBE_API_KEY"],
      ["youtube", "gb", "skipped", 0, "missing YOUTUBE_API_KEY"],
      ["youtube", "ca", "skipped", 0, "missing YOUTUBE_API_KEY"],
      ["youtube", "au", "skipped", 0, "missing YOUTUBE_API_KEY"],
      ["heartbeat", "global", "ok", 0, null],
    ]);
    const items = await t.db.select().from(trendItems).orderBy(asc(trendItems.rank));
    expect(items.map((i) => [i.runId, i.sourceId, i.rank, i.title, i.metricValue, i.metricLabel])).toEqual([
      [runs[0].id, "bluesky", 1, "Example Final", 10, "posts"],
      [runs[0].id, "bluesky", 2, "Test Launch", null, null],
    ]);
    expect(out.lines.slice(0, 2)).toEqual([
      "rank: 2 items kept, 0 dropped; 2 matched to topics, 2 new topics, 4 topic snapshots",
      "combined top 10:",
    ]);
    expect(out.lines.slice(-3)).toEqual([
      "error: mastodon (global): 503 mastodon.social: Service Unavailable",
      "revalidate: skipped (SITE_URL or REVALIDATE_SECRET not set)",
      "run ok: heartbeat written, 1 lists ok, 1 failed, 4 skipped, 8 sources not built yet (0 ms)",
    ]);
    expect(await t.db.select().from(topics)).toHaveLength(2);
    const ranked = await t.db.select().from(rankings);
    // One combined list per view: Global and US.
    expect(ranked.filter((r) => r.list === "combined").map((r) => [r.region, r.rank])).toEqual([
      ["global", 1],
      ["global", 2],
      ["us", 1],
      ["us", 2],
    ]);
    expect(ranked.filter((r) => r.list === "bluesky").map((r) => [r.rank, r.itemId !== null, r.topicId !== null])).toEqual([
      [1, true, true],
      [2, true, true],
    ]);
  });

  it("names the top 10's topics with Claude when ANTHROPIC_API_KEY is set, and a failure there never fails the run", async () => {
    const db = await createTestDb();
    try {
      // Bluesky gives a description, so there is something to summarize.
      const collectors: ReadonlyMap<SourceId, Collector> = new Map<SourceId, Collector>([
        [
          "bluesky",
          {
            id: "bluesky",
            fetch: async (region) => [
              { source: "bluesky", region, rank: 1, title: "Example Final", url: "https://bsky.app/a", matchText: ["Fans react to the example final"] },
            ],
          },
        ],
      ]);
      const keys: string[] = [];
      const run = (createNamer: NonNullable<Parameters<typeof runPipeline>[2]["createNamer"]>, at: string) => {
        const out = capture();
        return runPipeline([], { SESSION_DATABASE_URL: sessionUrl, ANTHROPIC_API_KEY: "test-key" }, {
          openDb: () => ({ db: db.db, close: async () => {} }),
          log: out.log,
          now: () => new Date(at),
          collectors,
          createNamer,
          ...offline,
        }).then(() => out.lines);
      };

      const failing = await run(() => {
        throw new Error("no client");
      }, "2026-10-21T12:07:00Z");
      expect(failing).toContain("names: failed: no client");
      expect(failing.at(-1)).toMatch(/^run ok: heartbeat written/);

      const lines = await run((apiKey) => {
        keys.push(apiKey);
        return async () => ({ name: "The Example Final", reason: "Fans are reacting to the final.", category: "sports" });
      }, "2026-10-21T13:07:00Z");
      expect(keys).toEqual(["test-key"]);
      expect(lines).toContain("names: 1 named");
      expect(lines).toContain("  Example Final → The Example Final [sports] · Fans are reacting to the final.");
      expect((await db.db.select().from(topics)).map((row) => [row.label, row.name, row.reason, row.category])).toEqual([
        ["Example Final", "The Example Final", "Fans are reacting to the final.", "sports"],
      ]);
    } finally {
      await db.close();
    }
  });

  it("fails a full run without SESSION_DATABASE_URL", async () => {
    await expect(
      runPipeline([], {}, { openDb: () => ({ db: t.db, close: async () => {} }), log: () => {}, collectors: new Map(), ...offline }),
    ).rejects.toThrow(/SESSION_DATABASE_URL/);
  });
});
