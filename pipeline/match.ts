import type { SourceId, SourceRole } from "@/collectors/registry";
import { MATCH_THRESHOLD } from "@/config/ranking";
import { dot, unitVector } from "@/lib/embed";
import { nameKey } from "@/lib/text";

// Topic matching (CLAUDE.md invariant 8): an item whose name is exactly a
// topic's name (its label's, or a member's) joins that topic; otherwise it
// joins the nearest topic centroid when cosine similarity is at least the
// threshold; otherwise a lead item starts a new topic and a corroborating
// item joins nothing. Vectors are compared with topic centroids, never with
// each other, so unrelated items can't chain together.
//
// The name rule exists because a Google trend's vector includes its
// headlines and an X trend's is a bare name: "Bahrain GP" against
// "bahrain gp. headline. headline" scores about 0.80, under the threshold,
// so the same name used to become two topics.
// Pure: persistence lives in pipeline/topics.ts.

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
  // Name keys (lib/text.ts nameKey) of its label and of its members from the
  // topic window; not stored, rebuilt from the items when topics are loaded.
  names?: Set<string>;
}

export interface MatchOptions {
  threshold?: number;
  now: Date;
  // Off only to compare in a replay: join by name before comparing vectors.
  nameMatch?: boolean;
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
  const topics: Topic[] = existing.map((t) => ({ ...t, centroid: [...t.centroid], names: new Set([...(t.names ?? []), nameKey(t.label)]) }));
  const assignments = new Map<number, Topic>();
  const similarities = new Map<number, number>();
  // Each name's topic: the oldest one that has it, so two topics that already
  // share a name (made before this rule) come back together.
  const byName = new Map<string, Topic>();
  const claim = (name: string, topic: Topic) => {
    if (!name) return;
    topic.names?.add(name);
    if (!byName.has(name)) byName.set(name, topic);
  };
  const oldestFirst = [...topics].sort((a, b) => a.firstSeen.getTime() - b.firstSeen.getTime() || (a.id ?? Infinity) - (b.id ?? Infinity));
  for (const topic of oldestFirst) for (const name of [...(topic.names ?? [])]) claim(name, topic);

  for (const item of matchOrder(items)) {
    const name = nameKey(item.title);
    const named = options.nameMatch === false ? undefined : byName.get(name);
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

    const joined = named ?? (best && bestSimilarity >= threshold ? best : null);
    if (joined) {
      claim(name, joined);
      // Running mean of the member vectors, re-normalized.
      joined.centroid = unitVector(joined.centroid.map((c, i) => c * joined.count + item.vector[i]));
      joined.count += 1;
      joined.lastSeen = options.now;
      joined.changed = true;
      if (joined.summary === null) joined.summary = options.contextFor(item);
      assignments.set(item.key, joined);
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
        names: new Set<string>(),
      };
      claim(nameKey(topic.label), topic);
      claim(name, topic);
      topics.push(topic);
      assignments.set(item.key, topic);
    }
  }

  return { topics, assignments, similarities };
}
