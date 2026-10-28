import { describe, expect, it } from "vitest";
import type { SourceId, SourceRole } from "@/collectors/registry";
import { dot, unitVector } from "@/lib/embed";
import { matchItems, matchOrder, type MatchItem, type Topic } from "./match";

const now = new Date("2026-10-08T12:07:00Z");
const options = { threshold: 0.8, now, labelFor: (i: MatchItem) => i.title, contextFor: () => null };

let key = 0;
function item(sourceId: SourceId, role: SourceRole, rank: number, vector: number[], title = `item ${key + 1}`): MatchItem {
  key += 1;
  return { key, sourceId, role, rank, weight: 1, title, vector: unitVector(vector) };
}

function topic(id: number, vector: number[], count = 1): Topic {
  return {
    id,
    label: `topic ${id}`,
    summary: null,
    centroid: unitVector(vector),
    count,
    firstSeen: new Date("2026-10-08T10:07:00Z"),
    lastSeen: new Date("2026-10-08T11:07:00Z"),
    isNew: false,
    changed: false,
  };
}

// Axis-aligned directions: x and y are unrelated (similarity 0);
// [1, 0.3, 0] is close to x (0.96) and [1, 1, 0] is half-way (0.71).
const X = [1, 0, 0];
const NEAR_X = [1, 0.3, 0];
const HALF = [1, 1, 0];
const Y = [0, 1, 0];

describe("matchOrder", () => {
  it("puts lead items first, each group by best rank", () => {
    const items = [item("youtube", "corroborating", 1, X), item("bluesky", "lead", 3, X), item("google_trends", "lead", 1, X)];
    expect(matchOrder(items).map((i) => [i.sourceId, i.rank])).toEqual([
      ["google_trends", 1],
      ["bluesky", 3],
      ["youtube", 1],
    ]);
  });
});

describe("matchItems", () => {
  it("joins an existing topic at or above the threshold and updates its centroid and last_seen", () => {
    const existing = topic(1, X, 3);
    const joining = item("bluesky", "lead", 1, NEAR_X);
    const result = matchItems([joining], [existing], options);
    const joined = result.assignments.get(joining.key)!;
    expect(joined.id).toBe(1);
    expect(joined.count).toBe(4);
    expect(joined.lastSeen).toEqual(now);
    expect(joined.changed).toBe(true);
    // Running mean of 3 × X and NEAR_X, re-normalized.
    expect(joined.centroid).toEqual(unitVector([3 + unitVector(NEAR_X)[0], unitVector(NEAR_X)[1], 0]));
    expect(dot(joined.centroid, joined.centroid)).toBeCloseTo(1);
    expect(existing.count).toBe(3); // the input is not mutated
  });

  it("starts a new topic for an unmatched lead item, and later items can join it in the same run", () => {
    const first = item("google_trends", "lead", 1, Y, "dodgers vs yankees");
    const second = item("bluesky", "lead", 2, Y, "#WorldSeries");
    const result = matchItems([second, first], [topic(1, X)], options);
    const created = result.assignments.get(first.key)!;
    expect(created).toMatchObject({ id: null, isNew: true, label: "dodgers vs yankees", count: 2 });
    expect(result.assignments.get(second.key)).toBe(created);
    expect(result.topics).toHaveLength(2);
  });

  it("leaves an unmatched corroborating item without a topic", () => {
    const video = item("youtube", "corroborating", 1, Y);
    const result = matchItems([video], [topic(1, X)], options);
    expect(result.assignments.has(video.key)).toBe(false);
    expect(result.topics).toHaveLength(1);
  });

  it("lets a corroborating item join a topic a lead item created", () => {
    const lead = item("google_trends", "lead", 1, X);
    const video = item("youtube", "corroborating", 1, NEAR_X);
    const result = matchItems([video, lead], [], options);
    expect(result.assignments.get(video.key)).toBe(result.assignments.get(lead.key));
  });

  it("does not merge below the threshold", () => {
    const half = item("bluesky", "lead", 1, HALF);
    const result = matchItems([half], [topic(1, X)], options);
    expect(result.similarities.get(half.key)).toBeCloseTo(Math.SQRT1_2);
    expect(result.assignments.get(half.key)?.isNew).toBe(true);
  });

  it("compares items with centroids, not with each other, so chains don't form", () => {
    // Each step is 0.96 from the previous one, but the third is far from the first.
    const a = item("google_trends", "lead", 1, [1, 0, 0]);
    const b = item("bluesky", "lead", 2, [1, 0.3, 0]);
    const c = item("mastodon", "lead", 3, [1, 1.2, 0]);
    const result = matchItems([a, b, c], [], options);
    expect(result.assignments.get(b.key)).toBe(result.assignments.get(a.key));
    expect(result.assignments.get(c.key)).not.toBe(result.assignments.get(a.key));
  });

  it("fills a topic's missing context from a later item", () => {
    const existing = topic(1, X);
    const google = item("google_trends", "lead", 1, NEAR_X);
    const result = matchItems([google], [existing], { ...options, contextFor: () => "A headline" });
    expect(result.assignments.get(google.key)!.summary).toBe("A headline");
  });
});

describe("matching by name", () => {
  it("joins a topic that has exactly the item's name, however far apart the vectors are", () => {
    // X's bare name against Google's query with its headlines: unrelated vectors here.
    const google = item("google_trends", "lead", 1, X, "bahrain gp");
    const x = item("x", "lead", 2, Y, "#BahrainGP");
    const other = item("x", "lead", 3, Y, "Bahrain");
    const result = matchItems([google, x, other], [], options);
    expect(result.assignments.get(x.key)).toBe(result.assignments.get(google.key));
    expect(result.assignments.get(other.key)).not.toBe(result.assignments.get(google.key)); // a different name
    expect(result.topics.map((t) => [t.label, t.count])).toEqual([
      ["bahrain gp", 2],
      ["Bahrain", 1],
    ]);
  });

  it("matches a member's name as well as the label, and lets a corroborating item join by name", () => {
    const existing: Topic = { ...topic(1, X), label: "F1 returns to Sepang", names: new Set(["bahraingp"]) };
    const x = item("x", "lead", 1, Y, "Bahrain GP");
    const video = item("youtube", "corroborating", 1, Y, "F1 returns to Sepang");
    const result = matchItems([x, video], [existing], options);
    expect(result.assignments.get(x.key)?.id).toBe(1);
    expect(result.assignments.get(video.key)?.id).toBe(1);
    expect(result.topics).toHaveLength(1);
  });

  it("brings two topics that already share a name back together, at the older one", () => {
    const older: Topic = { ...topic(1, X), label: "Bahrain GP", firstSeen: new Date("2026-10-08T08:07:00Z") };
    const newer: Topic = { ...topic(2, Y), label: "bahrain gp", firstSeen: new Date("2026-10-08T09:07:00Z") };
    const google = item("google_trends", "lead", 1, Y, "bahrain gp"); // its vector is the newer topic's
    const result = matchItems([google], [newer, older], options);
    expect(result.assignments.get(google.key)?.id).toBe(1);
  });

  it("can be turned off, to compare in a replay", () => {
    const google = item("google_trends", "lead", 1, X, "bahrain gp");
    const x = item("x", "lead", 2, Y, "Bahrain GP");
    const result = matchItems([google, x], [], { ...options, nameMatch: false });
    expect(result.topics).toHaveLength(2);
  });
});

describe("the age limit", () => {
  // `now` is 12:07 on the 8th, so a topic first seen at 12:07 on the 6th is exactly 48 hours old.
  const aged = (id: number, vector: number[], firstSeen: string): Topic => ({ ...topic(id, vector), firstSeen: new Date(firstSeen) });

  it("starts a new topic when the nearest topic is over 48 hours old", () => {
    const old = aged(1, X, "2026-10-06T11:07:00Z");
    const lead = item("google_trends", "lead", 1, NEAR_X, "wild card game 3");
    const result = matchItems([lead], [old], options);
    expect(result.assignments.get(lead.key)?.isNew).toBe(true);
    expect(result.assignments.get(lead.key)?.label).toBe("wild card game 3");
    expect(result.topics.find((t) => t.id === 1)?.changed).toBe(false);
  });

  it("counts ages in whole clock hours, so a few seconds of start time never decide it", () => {
    const old = aged(1, X, "2026-10-06T12:07:59Z");
    const at = (time: string) => ({ ...options, now: new Date(time) });
    const lead = () => item("google_trends", "lead", 1, NEAR_X);
    // Two days on, a run that starts a moment earlier or later in the same hour decides the same.
    for (const time of ["2026-10-08T12:07:45Z", "2026-10-08T12:08:05Z", "2026-10-08T12:27:30Z"]) {
      const item1 = lead();
      expect(matchItems([item1], [old], at(time)).assignments.get(item1.key)?.id).toBe(1);
    }
    const later = lead();
    expect(matchItems([later], [old], at("2026-10-08T13:07:30Z")).assignments.get(later.key)?.isNew).toBe(true);
  });

  it("keeps a topic open through its 48th hour", () => {
    const old = aged(1, X, "2026-10-06T12:07:00Z");
    const lead = item("google_trends", "lead", 1, NEAR_X);
    expect(matchItems([lead], [old], options).assignments.get(lead.key)?.id).toBe(1);
  });

  it("does not join an old topic by name either, and the new topic takes the name", () => {
    const old: Topic = { ...aged(1, X, "2026-10-05T12:07:00Z"), label: "weather today" };
    const google = item("google_trends", "lead", 1, X, "weather today");
    const x = item("x", "lead", 2, Y, "Weather Today");
    const result = matchItems([google, x], [old], options);
    const fresh = result.assignments.get(google.key);
    expect(fresh?.isNew).toBe(true);
    expect(result.assignments.get(x.key)).toBe(fresh);
  });

  it("leaves a corroborating item without a topic when only an old topic is near", () => {
    const old = aged(1, X, "2026-10-05T12:07:00Z");
    const video = item("youtube", "corroborating", 1, X);
    expect(matchItems([video], [old], options).assignments.has(video.key)).toBe(false);
  });

  it("joins an open topic even when an old one is nearer", () => {
    const old = aged(1, X, "2026-10-05T12:07:00Z");
    const open = topic(2, NEAR_X);
    const lead = item("bluesky", "lead", 1, X);
    expect(matchItems([lead], [old, open], options).assignments.get(lead.key)?.id).toBe(2);
  });

  it("links the new topic to the aged-out topic it continues, by name first", () => {
    const old: Topic = { ...aged(1, Y, "2026-10-05T12:07:00Z"), label: "weather today" };
    const google = item("google_trends", "lead", 1, X, "weather today");
    const result = matchItems([google], [old], options);
    expect(result.assignments.get(google.key)?.continuesId).toBe(1);
  });

  it("links by the nearest aged-out centroid at the threshold when no name matches", () => {
    const near = aged(1, X, "2026-10-05T12:07:00Z");
    const far = aged(2, HALF, "2026-10-05T12:07:00Z");
    const lead = item("google_trends", "lead", 1, NEAR_X, "wild card game 3");
    const unrelated = item("x", "lead", 2, Y, "Lima");
    const result = matchItems([lead, unrelated], [far, near], options);
    expect(result.assignments.get(lead.key)?.continuesId).toBe(1);
    // HALF is about 0.71 from Y, under the threshold: a new story, no link.
    expect(result.assignments.get(unrelated.key)?.continuesId).toBeNull();
  });

  it("links to the newest aged-out topic with the name, so a long story is a chain", () => {
    const first: Topic = { ...aged(1, X, "2026-10-03T12:07:00Z"), label: "pneumonic plague" };
    const second: Topic = { ...aged(2, X, "2026-10-05T12:07:00Z"), label: "pneumonic plague" };
    const google = item("google_trends", "lead", 1, X, "pneumonic plague");
    expect(matchItems([google], [first, second], options).assignments.get(google.key)?.continuesId).toBe(2);
  });

  it("leaves the link empty for a topic that continues nothing, and for an item that joins an open topic", () => {
    const open = topic(2, X);
    const joins = item("google_trends", "lead", 1, NEAR_X);
    const fresh = item("x", "lead", 2, Y, "Lima");
    const result = matchItems([joins, fresh], [open], options);
    expect(result.assignments.get(joins.key)?.continuesId).toBeUndefined();
    expect(result.assignments.get(fresh.key)?.continuesId).toBeNull();
  });

  it("can be lifted, to compare in a replay", () => {
    const old = aged(1, X, "2026-10-05T12:07:00Z");
    const lead = item("google_trends", "lead", 1, NEAR_X);
    expect(matchItems([lead], [old], { ...options, maxTopicAgeHours: Infinity }).assignments.get(lead.key)?.id).toBe(1);
  });
});
