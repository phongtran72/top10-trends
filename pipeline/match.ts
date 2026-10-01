import type { SourceId, SourceRole } from "@/collectors/registry";
import { MATCH_THRESHOLD } from "@/config/ranking";
import { dot, unitVector } from "@/lib/embed";

// Topic matching (CLAUDE.md invariant 8): each item joins the nearest topic
// centroid when cosine similarity is at least the threshold; otherwise a lead
// item starts a new topic and a corroborating item joins nothing. Items are
// compared with topic centroids, never with each other, so unrelated items
// can't chain together. Pure: persistence lives in pipeline/topics.ts.

export interface MatchItem {
  key: number; // stable id for the caller (the trend_items id in a full run)
  sourceId: SourceId;
  role: SourceRole;
  rank: number;
  weight: number;
  title: string;
  matchText?: string[];
  vector: number[]; // unit vector
}

export interface Topic {
  id: number | null; // null until a new topic is saved
  label: string;
  summary: string | null;
  centroid: number[]; // unit vector
  count: number; // items that shaped the centroid
  firstSeen: Date;
  lastSeen: Date;
  isNew: boolean;
  changed: boolean;
}

export interface MatchOptions {
  threshold?: number;
  now: Date;
  // Label and one-line context for a new topic, and context for a topic that
  // has none yet (task 2.6 fills these in).
  labelFor: (item: MatchItem) => string;
  contextFor: (item: MatchItem) => string | null;
}

export interface MatchResult {
  topics: Topic[];
  assignments: Map<number, Topic>; // item key → topic
  similarities: Map<number, number>; // item key → best similarity seen
}

// Lead items first, best rank first (higher weight breaks ties), then the
// corroborating items the same way.
export function matchOrder(items: readonly MatchItem[]): MatchItem[] {
  const byRank = (a: MatchItem, b: MatchItem) => a.rank - b.rank || b.weight - a.weight || a.key - b.key;
  return [
    ...items.filter((i) => i.role === "lead").sort(byRank),
    ...items.filter((i) => i.role !== "lead").sort(byRank),
  ];
}

export function matchItems(items: readonly MatchItem[], existing: readonly Topic[], options: MatchOptions): MatchResult {
  const threshold = options.threshold ?? MATCH_THRESHOLD;
  const topics = existing.map((t) => ({ ...t, centroid: [...t.centroid] }));
  const assignments = new Map<number, Topic>();
  const similarities = new Map<number, number>();

  for (const item of matchOrder(items)) {
    let best: Topic | null = null;
    let bestSimilarity = -Infinity;
    for (const topic of topics) {
      const similarity = dot(item.vector, topic.centroid);
      if (similarity > bestSimilarity) {
        best = topic;
        bestSimilarity = similarity;
      }
    }
    if (best) similarities.set(item.key, bestSimilarity);

    if (best && bestSimilarity >= threshold) {
      // Running mean of the member vectors, re-normalized.
      best.centroid = unitVector(best.centroid.map((c, i) => c * best.count + item.vector[i]));
      best.count += 1;
      best.lastSeen = options.now;
      best.changed = true;
      if (best.summary === null) best.summary = options.contextFor(item);
      assignments.set(item.key, best);
    } else if (item.role === "lead") {
      const topic: Topic = {
        id: null,
        label: options.labelFor(item),
        summary: options.contextFor(item),
        centroid: [...item.vector],
        count: 1,
        firstSeen: options.now,
        lastSeen: options.now,
        isNew: true,
        changed: true,
      };
      topics.push(topic);
      assignments.set(item.key, topic);
    }
  }

  return { topics, assignments, similarities };
}
