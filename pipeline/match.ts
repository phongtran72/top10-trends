import type { SourceId, SourceRole } from "@/collectors/registry";
import { MATCH_THRESHOLD, MAX_TOPIC_AGE_HOURS } from "@/config/ranking";
import { dot, unitVector } from "@/lib/embed";
import { nameKey } from "@/lib/text";

// Topic matching (CLAUDE.md invariant 8): an item whose name is exactly a
// topic's name (its label's, or a member's) joins that topic; otherwise it
// joins the nearest topic centroid when cosine similarity is at least the
// threshold; otherwise a lead item starts a new topic and a corroborating
// item joins nothing. Vectors are compared with topic centroids, never with
// each other, so unrelated items can't chain together.
//
// A topic is open to new members for 48 hours from its first sighting
// (MAX_TOPIC_AGE_HOURS), under both rules. After that an item that would
// have joined it starts a new topic, so a subject that trends every day
// can't keep one topic alive for weeks. The new topic records the aged-out
// one it continues: the newest one that has the item's name, otherwise the
// nearest aged-out centroid at the threshold, so a long story is a chain.
//
// The name rule exists because a Google trend's vector includes its
// headlines and an X trend's is a bare name: "Bahrain GP" against
// "bahrain gp. headline. headline" scores about 0.80, under the threshold,
// so the same name used to become two topics.
// Pure: persistence lives in pipeline/topics.ts.

const HOUR_MS = 60 * 60 * 1000;

// The start of the clock hour `at` falls in (UTC). Ages and the topic window
// are counted in whole hours from there (r8): counted to the second, whether a
// topic was still open in the run two days on came down to a few seconds of
// start time, and a replay could decide differently from the live run.
export function hourStart(at: Date): number {
  return Math.floor(at.getTime() / HOUR_MS) * HOUR_MS;
}

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
  // The category model's answer for a new topic (pipeline/category.ts),
  // saved with it and never changed.
  modelCategory?: string | null;
  modelCategoryVersion?: string | null;
  // For a new topic: the id of the aged-out topic it continues, if any.
  continuesId?: number | null;
}

export interface MatchOptions {
  threshold?: number;
  now: Date;
  // Off only to compare in a replay: join by name before comparing vectors.
  nameMatch?: boolean;
  // Infinity only to compare in a replay: the age at which a topic stops
  // taking members.
  maxTopicAgeHours?: number;
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
  // Open while the run's clock hour is at most 48 hours after the topic's first.
  const oldest = hourStart(options.now) - (options.maxTopicAgeHours ?? MAX_TOPIC_AGE_HOURS) * HOUR_MS;
  const open = (topic: Topic) => topic.firstSeen.getTime() >= oldest;
  const oldestFirst = [...topics].sort((a, b) => a.firstSeen.getTime() - b.firstSeen.getTime() || (a.id ?? Infinity) - (b.id ?? Infinity));
  for (const topic of oldestFirst) if (open(topic)) for (const name of [...(topic.names ?? [])]) claim(name, topic);
  // Aged-out topics by name, newest first, for the link a new topic records.
  const agedOutByName = new Map<string, Topic>();
  for (const topic of [...oldestFirst].reverse()) {
    if (open(topic) || topic.id === null) continue;
    for (const name of topic.names ?? []) if (name && !agedOutByName.has(name)) agedOutByName.set(name, topic);
  }

  for (const item of matchOrder(items)) {
    const name = nameKey(item.title);
    const named = options.nameMatch === false ? undefined : byName.get(name);
    let best: Topic | null = null;
    let bestSimilarity = -Infinity;
    let agedOut: Topic | null = null;
    let agedOutSimilarity = -Infinity;
    for (const topic of topics) {
      const similarity = dot(item.vector, topic.centroid);
      if (!open(topic)) {
        if (topic.id !== null && similarity > agedOutSimilarity) {
          agedOut = topic;
          agedOutSimilarity = similarity;
        }
        continue;
      }
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
        continuesId:
          (options.nameMatch === false ? undefined : agedOutByName.get(name))?.id ??
          (agedOut && agedOutSimilarity >= threshold ? agedOut.id : null),
      };
      claim(nameKey(topic.label), topic);
      claim(name, topic);
      topics.push(topic);
      assignments.set(item.key, topic);
    }
  }

  return { topics, assignments, similarities };
}
