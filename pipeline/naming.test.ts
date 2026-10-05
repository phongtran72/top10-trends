import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc } from "drizzle-orm";
import { getSource, planSources, type SourceId } from "@/collectors/registry";
import type { Region, TrendItem } from "@/collectors/types";
import { topics } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { writeResults, type ListResult } from "./collect";
import { formatNaming, hasContext, nameTopics, NamingUnavailable, namingInputs, tidyNaming, type NamingInput, type TopicNamer } from "./naming";
import { rankRun } from "./rank";
import { upsertSources } from "./sources";
import { WORD_EMBEDDER_THRESHOLD, wordEmbedder } from "./test-embedder";

let t: Awaited<ReturnType<typeof createTestDb>>;
const now = new Date("2026-10-20T12:07:00Z");
let top: number[] = [];
const idOf = new Map<string, number>();

function list(sourceId: SourceId, region: Region, items: Partial<TrendItem>[]): ListResult {
  return {
    source: getSource(sourceId),
    region,
    status: "ok",
    items: items.map((item, i) => ({ source: sourceId, region, rank: i + 1, title: "", url: `https://example.com/${sourceId}/${region}/${i + 1}`, ...item })),
    startedAt: now,
    finishedAt: now,
  };
}

beforeAll(async () => {
  t = await createTestDb();
  await upsertSources(t.db, planSources({ collectors: new Set(), disabled: [], env: {} }));
  const results = [
    list("google_trends", "us", [
      { title: "harbor fire", metricValue: 5000, matchText: ["Crews battle a fire at the harbor", "Harbor fire closes the port"] },
      { title: "tower strike", metricValue: 2000, matchText: ["Tower strike enters its second day"] },
    ]),
    list("x", "us", [{ title: "#HarborFire" }, { title: "Quartz" }]),
    list("youtube", "us", [{ title: "Harbor fire" }]),
  ];
  const itemIds = await writeResults(t.db, results);
  const outcome = await rankRun({ db: t.db, results, itemIds, now, embedder: wordEmbedder, blocklist: new Set(), threshold: WORD_EMBEDDER_THRESHOLD });
  top = outcome.topTopicIds;
  for (const row of await t.db.select().from(topics)) idOf.set(row.label, row.id);
});

afterAll(async () => {
  await t.close();
});

describe("tidyNaming", () => {
  it("cleans the name and keeps a reason within 120 characters", () => {
    expect(tidyNaming({ name: ' "Bahrain Grand Prix." ', reason: " Verstappen won   the race. " })).toEqual({
      name: "Bahrain Grand Prix",
      reason: "Verstappen won the race.",
    });
    expect(tidyNaming({ name: "#BahrainGP", reason: "" })).toEqual({ name: "BahrainGP", reason: null });
    const long = tidyNaming({ name: "Budget vote", reason: `${"word ".repeat(40)}end` });
    expect(long?.reason?.length).toBeLessThanOrEqual(120);
    expect(long?.reason?.endsWith("word…")).toBe(true);
  });

  it("drops an answer whose name is empty, too long or profane", () => {
    expect(tidyNaming({ name: "  ", reason: "x" })).toBeNull();
    expect(tidyNaming({ name: "x".repeat(61), reason: null })).toBeNull();
    expect(tidyNaming({ name: "what the fuck", reason: null })).toBeNull();
    expect(tidyNaming({ name: "Budget vote", reason: "what the fuck" })).toEqual({ name: "Budget vote", reason: null });
  });
});

describe("namingInputs", () => {
  it("gathers each topic's titles and stored match text, and never a YouTube title", async () => {
    const inputs = await namingInputs(t.db, top, now);
    expect(inputs.get(idOf.get("harbor fire")!)).toEqual({
      label: "harbor fire",
      listed: [
        { source: "Google Trends", title: "harbor fire" },
        { source: "X", title: "#HarborFire" },
      ],
      texts: ["Crews battle a fire at the harbor", "Harbor fire closes the port"],
    });
    expect(inputs.get(idOf.get("Quartz")!)).toEqual({ label: "Quartz", listed: [{ source: "X", title: "Quartz" }], texts: [] });
  });

  it("asks only when there is something to summarize", () => {
    const bare: NamingInput = { label: "Quartz", listed: [{ source: "X", title: "Quartz" }, { source: "Mastodon", title: "#quartz" }], texts: [] };
    expect(hasContext(bare)).toBe(false);
    expect(hasContext({ ...bare, texts: ["A headline"] })).toBe(true);
    expect(hasContext({ ...bare, listed: [...bare.listed, { source: "Bluesky", title: "Quartz prices jump" }] })).toBe(true);
  });
});

describe("nameTopics", () => {
  it("names each topic once, leaves label and summary alone, and reports what it skipped", async () => {
    const asked: string[] = [];
    const namer: TopicNamer = async (input) => {
      asked.push(input.label);
      if (input.label === "tower strike") throw new Error("429 api.anthropic.com: rate limited");
      return { name: "Harbor Fire Closes Port", reason: "A fire at the harbor has closed the port." };
    };
    const outcome = await nameTopics(t.db, { topicIds: top, now, namer });
    expect(asked).toEqual(["harbor fire", "tower strike"]); // "Quartz" is a bare name: never sent
    expect(outcome).toMatchObject({ noContext: 1, unusable: 0, failed: ["429 api.anthropic.com: rate limited"], waiting: 0 });
    expect(formatNaming(outcome)).toEqual([
      "names: 1 named, 1 with nothing to go on, 1 failed (429 api.anthropic.com: rate limited)",
      "  harbor fire → Harbor Fire Closes Port · A fire at the harbor has closed the port.",
    ]);
    const rows = await t.db.select().from(topics).orderBy(asc(topics.id));
    expect(rows.map((r) => [r.label, r.summary, r.name, r.reason])).toEqual([
      ["harbor fire", "Crews battle a fire at the harbor", "Harbor Fire Closes Port", "A fire at the harbor has closed the port."],
      ["tower strike", "Tower strike enters its second day", null, null],
      ["Quartz", null, null, null],
    ]);

    // A later run asks only about the topic that still has no name.
    asked.length = 0;
    const again = await nameTopics(t.db, { topicIds: top, now, namer: async (input) => (asked.push(input.label), { name: "Tower Strike", reason: null }) });
    expect(asked).toEqual(["tower strike"]);
    expect(again.named.map((n) => [n.label, n.name, n.reason])).toEqual([["tower strike", "Tower Strike", null]]);
  });

  it("stops at the cap, at the time budget, and when the key is refused", async () => {
    await t.db.update(topics).set({ name: null, reason: null });
    const capped = await nameTopics(t.db, { topicIds: top, now, namer: async () => ({ name: "A name", reason: null }), limit: 1 });
    expect([capped.named.length, capped.waiting]).toEqual([1, 1]);

    await t.db.update(topics).set({ name: null, reason: null });
    const late = await nameTopics(t.db, { topicIds: top, now, namer: async () => ({ name: "A name", reason: null }), budgetMs: 0 });
    expect([late.named.length, late.waiting]).toEqual([0, 2]);

    let calls = 0;
    const refused = await nameTopics(t.db, {
      topicIds: top,
      now,
      namer: async () => {
        calls += 1;
        throw new NamingUnavailable("401 api.anthropic.com: the API key was refused");
      },
    });
    expect(calls).toBe(1);
    expect([refused.failed.length, refused.waiting]).toEqual([1, 1]);
  });

  it("keeps the label when the model declines or its answer fails the checks", async () => {
    const declined = await nameTopics(t.db, { topicIds: top, now, namer: async () => null });
    expect([declined.named.length, declined.unusable]).toEqual([0, 2]);
    const tooLong = await nameTopics(t.db, { topicIds: top, now, namer: async () => ({ name: "x".repeat(80), reason: null }) });
    expect(tooLong.unusable).toBe(2);
    expect((await t.db.select().from(topics)).every((row) => row.name === null)).toBe(true);
  });
});
