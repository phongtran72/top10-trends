import { and, desc, eq, gt, inArray, isNull, lte, notInArray } from "drizzle-orm";
import { getSource, SOURCES, type SourceId } from "@/collectors/registry";
import {
  NAME_MAX_LENGTH,
  NAMES_PER_RUN,
  NAMING_BUDGET_MS,
  NAMING_MAX_TEXTS,
  NAMING_MAX_TITLES,
  NAMING_TEXT_LENGTH,
  REASON_MAX_LENGTH,
} from "@/config/naming";
import { FRESH_LIST_HOURS } from "@/config/ranking";
import { topicItems, topics, trendItems } from "@/db/schema";
import { describeError } from "@/lib/errors";
import { nameKey } from "@/lib/text";
import type { Db } from "./db";
import { hasProfanity } from "./filter";
import { RUN_LIST_MARGIN_MS } from "./score";
import { EXCLUDED_FROM_HISTORY } from "./snapshots";

// Topic names (task 3.6): the first time a topic is in a combined top 10,
// Claude writes it a short display name and a one-line reason, from the names
// the platforms list it under and the stored headlines. They go in
// `topics.name` and `topics.reason`; `label` (the platform's own wording, which
// matching uses) and `summary` (the first headline) are never touched, so
// matching and replays don't depend on what a model wrote.
//
// A topic is named once and never renamed. YouTube titles are never sent or
// used: the name is kept for good, and YouTube's policy allows neither.

export interface NamingInput {
  label: string;
  listed: { source: string; title: string }[];
  texts: string[];
}

export interface Naming {
  name: string;
  reason: string | null;
}

// Null when the model declines or its answer can't be used.
export type TopicNamer = (input: NamingInput) => Promise<{ name: string; reason: string | null } | null>;

// Thrown by a namer when no later call can succeed this run (a refused key).
export class NamingUnavailable extends Error {}

const tidy = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .trim();

// The model's answer, checked: a name that is too long, empty or profane is
// dropped whole (a cut-off name misleads); a long reason is cut at a word.
export function tidyNaming(raw: { name: string; reason: string | null }): Naming | null {
  const name = tidy(raw.name).replace(/^#+/, "").replace(/\.$/, "");
  if (!nameKey(name) || name.length > NAME_MAX_LENGTH || hasProfanity(name)) return null;
  let reason: string | null = tidy(raw.reason ?? "");
  if (reason.length > REASON_MAX_LENGTH) {
    const cut = reason.slice(0, REASON_MAX_LENGTH - 1);
    reason = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[\s,;:]+$/, "")}…`;
  }
  if (!reason || hasProfanity(reason)) reason = null;
  return { name, reason };
}

const known = new Set<string>(SOURCES.map((s) => s.id));

// What Claude is shown for each topic: the titles its members had in the last
// three hours and their stored match text, newest first.
export async function namingInputs(db: Db, topicIds: readonly number[], now: Date): Promise<Map<number, NamingInput>> {
  const inputs = new Map<number, NamingInput>();
  if (topicIds.length === 0) return inputs;
  const rows = await db
    .select({
      topicId: topics.id,
      label: topics.label,
      sourceId: trendItems.sourceId,
      title: trendItems.title,
      matchText: trendItems.matchText,
    })
    .from(topics)
    .innerJoin(topicItems, eq(topicItems.topicId, topics.id))
    .innerJoin(trendItems, eq(trendItems.id, topicItems.itemId))
    .where(
      and(
        inArray(topics.id, [...topicIds]),
        notInArray(trendItems.sourceId, [...EXCLUDED_FROM_HISTORY]),
        gt(trendItems.fetchedAt, new Date(now.getTime() - FRESH_LIST_HOURS * 60 * 60 * 1000)),
        lte(trendItems.fetchedAt, new Date(now.getTime() + RUN_LIST_MARGIN_MS)),
      ),
    )
    .orderBy(desc(trendItems.fetchedAt), trendItems.rank);
  const seen = new Map<number, { titles: Set<string>; texts: Set<string> }>();
  for (const row of rows) {
    if (!known.has(row.sourceId)) continue;
    const input = inputs.get(row.topicId) ?? { label: row.label, listed: [], texts: [] };
    const had = seen.get(row.topicId) ?? { titles: new Set<string>(), texts: new Set<string>() };
    const source = getSource(row.sourceId as SourceId).name;
    const titleKey = `${source}/${nameKey(row.title)}`;
    if (!had.titles.has(titleKey) && input.listed.length < NAMING_MAX_TITLES) {
      had.titles.add(titleKey);
      input.listed.push({ source, title: row.title });
    }
    for (const text of row.matchText ?? []) {
      const short = text.trim().slice(0, NAMING_TEXT_LENGTH);
      if (!short || had.texts.has(short.toLowerCase()) || input.texts.length >= NAMING_MAX_TEXTS) continue;
      had.texts.add(short.toLowerCase());
      input.texts.push(short);
    }
    inputs.set(row.topicId, input);
    seen.set(row.topicId, had);
  }
  return inputs;
}

// Worth a call only when there is something to summarize: a headline or
// description, or two different names. A single bare name ("Lucki" on X alone)
// would only invite a made-up reason.
export function hasContext(input: NamingInput): boolean {
  return input.texts.length > 0 || new Set(input.listed.map((entry) => nameKey(entry.title))).size >= 2;
}

export interface NamingOutcome {
  named: { topicId: number; label: string; name: string; reason: string | null }[];
  noContext: number;
  unusable: number; // declined, or an answer that failed the checks
  failed: string[]; // short error reasons
  waiting: number; // left for the next run: over the cap or out of time
}

export interface NamingOptions {
  topicIds: readonly number[]; // the combined top 10s' topics, best first
  now: Date;
  namer: TopicNamer;
  limit?: number;
  budgetMs?: number;
  clock?: () => number;
}

// Names the given topics that have no name yet. Never throws for one topic's
// failure; the caller wraps the whole step so it can never fail the run.
export async function nameTopics(db: Db, options: NamingOptions): Promise<NamingOutcome> {
  const outcome: NamingOutcome = { named: [], noContext: 0, unusable: 0, failed: [], waiting: 0 };
  const ids = [...new Set(options.topicIds)];
  if (ids.length === 0) return outcome;
  const unnamed = new Set(
    (await db.select({ id: topics.id }).from(topics).where(and(inArray(topics.id, ids), isNull(topics.name)))).map((row) => row.id),
  );
  const inputs = await namingInputs(db, ids.filter((id) => unnamed.has(id)), options.now);
  const clock = options.clock ?? Date.now;
  const deadline = clock() + (options.budgetMs ?? NAMING_BUDGET_MS);
  let calls = 0;
  let stopped = false;
  for (const topicId of ids) {
    if (!unnamed.has(topicId)) continue;
    const input = inputs.get(topicId);
    if (!input || !hasContext(input)) {
      outcome.noContext += 1;
      continue;
    }
    if (stopped || calls >= (options.limit ?? NAMES_PER_RUN) || clock() >= deadline) {
      outcome.waiting += 1;
      continue;
    }
    calls += 1;
    try {
      const answer = await options.namer(input);
      const naming = answer ? tidyNaming(answer) : null;
      if (!naming) {
        outcome.unusable += 1;
        continue;
      }
      // Named once: the `name is null` guard keeps a concurrent run from renaming it.
      await db.update(topics).set({ name: naming.name, reason: naming.reason }).where(and(eq(topics.id, topicId), isNull(topics.name)));
      outcome.named.push({ topicId, label: input.label, ...naming });
    } catch (error) {
      outcome.failed.push(describeError(error));
      if (error instanceof NamingUnavailable) stopped = true;
    }
  }
  return outcome;
}

export function formatNaming(outcome: NamingOutcome): string[] {
  const parts = [`${outcome.named.length} named`];
  if (outcome.noContext > 0) parts.push(`${outcome.noContext} with nothing to go on`);
  if (outcome.unusable > 0) parts.push(`${outcome.unusable} declined or unusable`);
  if (outcome.failed.length > 0) parts.push(`${outcome.failed.length} failed (${[...new Set(outcome.failed)].join("; ")})`);
  if (outcome.waiting > 0) parts.push(`${outcome.waiting} left for the next run`);
  return [
    `names: ${parts.join(", ")}`,
    ...outcome.named.map((n) => `  ${n.label} → ${n.name}${n.reason ? ` · ${n.reason}` : ""}`),
  ];
}
