import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SourceId, SourceRole } from "@/collectors/registry";
import { EMBEDDING_DIMENSIONS, unitVector } from "@/lib/embed";
import { categorizeNewTopics, loadCategorizer, type Categorizer } from "./category";
import { matchItems, type MatchItem, type Topic } from "./match";

const now = new Date("2026-10-14T12:07:00Z");
const options = { threshold: 0.8, now, labelFor: (i: MatchItem) => i.title, contextFor: () => null };

let key = 0;
function item(sourceId: SourceId, role: SourceRole, rank: number, vector: number[], title: string, matchText?: string[]): MatchItem {
  key += 1;
  return { key, sourceId, role, rank, weight: 1, title, matchText, vector: unitVector(vector) };
}

const X = [1, 0, 0];
const Y = [0, 1, 0];
const Z = [0, 0, 1];

// A stand-in for the model: sports for anything on the x axis, unsure otherwise.
function model(calls: { source: SourceId; matchText?: string[] }[] = []): Categorizer {
  return (asked, vector) => {
    calls.push(asked);
    return { category: vector[0] > 0.9 ? "sports" : null, version: "c1" };
  };
}

describe("categorizeNewTopics", () => {
  it("asks about a new topic's first member with a stored text, in match order", () => {
    const bare = item("x", "lead", 1, X, "Quartz Derby");
    const withText = item("google_trends", "lead", 2, X, "quartz derby", ["  Riders gather before the mountain stage  ", ""]);
    const later = item("bluesky", "lead", 3, X, "Quartz Derby stage 4", ["A description"]);
    const items = [later, withText, bare];
    const match = matchItems(items, [], options);
    const calls: { source: SourceId; matchText?: string[] }[] = [];

    expect(categorizeNewTopics(items, match, model(calls))).toEqual({ asked: 1, answered: 1 });
    // X's bare name has no text; Google's query is the first member that does, and its text is passed as stored.
    expect(calls).toEqual([{ source: "google_trends", matchText: ["Riders gather before the mountain stage"] }]);
    expect(match.topics.map((t) => [t.label, t.modelCategory, t.modelCategoryVersion])).toEqual([["Quartz Derby", "sports", "c1"]]);
  });

  it("writes the version alone when the model isn't sure, and nothing when there is no text", () => {
    const unsure = item("google_trends", "lead", 1, Y, "tango forecast", ["Rain expected"]);
    const bare = item("x", "lead", 2, Z, "Lima");
    const items = [unsure, bare];
    const match = matchItems(items, [], options);

    expect(categorizeNewTopics(items, match, model())).toEqual({ asked: 1, answered: 0 });
    expect(match.topics.map((t) => [t.label, t.modelCategory, t.modelCategoryVersion])).toEqual([
      ["tango forecast", null, "c1"],
      ["Lima", undefined, undefined],
    ]);
  });

  it("leaves a topic from an earlier run alone", () => {
    const earlier: Topic = {
      id: 7,
      label: "quartz derby",
      summary: null,
      centroid: unitVector(X),
      count: 1,
      firstSeen: new Date("2026-10-14T10:07:00Z"),
      lastSeen: new Date("2026-10-14T11:07:00Z"),
      isNew: false,
      changed: false,
    };
    const items = [item("google_trends", "lead", 1, X, "quartz derby", ["Riders gather"])];
    const match = matchItems(items, [earlier], options);
    const calls: { source: SourceId }[] = [];

    expect(categorizeNewTopics(items, match, model(calls))).toEqual({ asked: 0, answered: 0 });
    expect(calls).toEqual([]);
    expect(match.topics[0].modelCategoryVersion).toBeUndefined();
  });

  it("stores only a category from the shared list, and a short version", () => {
    const items = [item("bluesky", "lead", 1, X, "Echo summit", ["A description"])];
    const match = matchItems(items, [], options);
    const odd: Categorizer = () => ({ category: "astrology", version: "v".repeat(100) });

    expect(categorizeNewTopics(items, match, odd)).toEqual({ asked: 1, answered: 0 });
    expect(match.topics[0].modelCategory).toBeNull();
    expect(match.topics[0].modelCategoryVersion).toHaveLength(40);
  });

  it("counts nothing when the model says the item has no text", () => {
    const items = [item("bluesky", "lead", 1, X, "Echo summit", ["A description"])];
    const match = matchItems(items, [], options);
    expect(categorizeNewTopics(items, match, () => null)).toEqual({ asked: 0, answered: 0 });
    expect(match.topics[0].modelCategoryVersion).toBeUndefined();
  });
});

describe("loadCategorizer", () => {
  const capture = () => {
    const lines: string[] = [];
    return { lines, log: (line: string) => lines.push(line) };
  };

  it("loads the model that ships and answers for an item with a text", () => {
    const out = capture();
    const categorize = loadCategorizer(out.log);
    expect(categorize).toBeDefined();
    expect(out.lines).toEqual([]);
    const vector = unitVector(Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => Math.sin(i + 1)));
    const answer = categorize!({ source: "google_trends", matchText: ["A made-up headline"] }, vector);
    expect(answer?.version).toMatch(/^c\d+$/);
    expect(categorize!({ source: "x" }, vector)).toBeNull();
  });

  it("is off, without a word, when there is no model file", () => {
    const out = capture();
    expect(loadCategorizer(out.log, path.join(tmpdir(), "no-such-category-model.json"))).toBeUndefined();
    expect(out.lines).toEqual([]);
  });

  it("is off, and says why, when the file can't be used", () => {
    const out = capture();
    const file = path.join(mkdtempSync(path.join(tmpdir(), "category-model-")), "category.json");
    writeFileSync(file, JSON.stringify({ version: "c0" }));
    expect(loadCategorizer(out.log, file)).toBeUndefined();
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatch(/^categories: off: /);
  });
});
