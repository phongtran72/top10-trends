import { existsSync } from "node:fs";
import path from "node:path";
import type { SourceId } from "@/collectors/registry";
import { TOPIC_CATEGORIES } from "@/config/naming";
import { categorize, loadCategoryModel } from "@/lib/category-model";
import { describeError } from "@/lib/errors";
import { storedMatchText } from "./collect";
import { matchOrder, type MatchItem, type MatchResult } from "./match";

// The category model's columns on a topic (task 5.14, PLAN.md › Who writes a
// topic's category): `model_category` and `model_category_version`, written
// once, in the run that creates the topic, and never again. Claude's
// `topics.category` is a separate column with its own writer (invariant 9).

// The model's answer for one item: null when the item has no stored text;
// otherwise its version, with a category when it is sure enough. The model
// and its scorer live in lib/category-model.ts; this step only calls them.
export type Categorizer = (item: { source: SourceId; matchText?: string[] }, vector: readonly number[]) => { category: string | null; version: string } | null;

export interface CategoryOutcome {
  asked: number; // new topics that had a member with a stored text
  answered: number; // of those, how many got a category
}

const VERSION_MAX = 40;

// The model in config/models/category.json as the rank step's function, or
// undefined when it can't be used: no file, a malformed file, or a model
// trained on other vectors than the pipeline now makes. The step is then off
// and the run goes on.
export function loadCategorizer(
  log: (line: string) => void,
  file = path.join(process.cwd(), "config", "models", "category.json"),
): Categorizer | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const model = loadCategoryModel(file);
    return (item, vector) => categorize(model, item, vector);
  } catch (error) {
    log(`categories: off: ${describeError(error)}`);
    return undefined;
  }
}

// Asks the model about each topic created in this run, from the topic's first
// member with a stored text in match order (a Google Trends query with its
// headlines, a Bluesky trend with its description; never a YouTube item, which
// has none). The answer is set on the topic and saved with it.
export function categorizeNewTopics(items: readonly MatchItem[], match: MatchResult, categorize: Categorizer): CategoryOutcome {
  const waiting = new Set(match.topics.filter((topic) => topic.isNew));
  const outcome: CategoryOutcome = { asked: 0, answered: 0 };
  for (const item of matchOrder(items)) {
    const topic = match.assignments.get(item.key);
    if (!topic || !waiting.has(topic)) continue;
    // The text as it is stored, so a replay of stored lists asks the same question.
    const matchText = storedMatchText(item.matchText);
    if (!matchText) continue;
    waiting.delete(topic);
    const answer = categorize({ source: item.sourceId, matchText }, item.vector);
    if (!answer) continue;
    outcome.asked += 1;
    topic.modelCategoryVersion = answer.version.slice(0, VERSION_MAX);
    // Only a category from the shared list is stored; anything else counts as no answer.
    topic.modelCategory = answer.category !== null && (TOPIC_CATEGORIES as readonly string[]).includes(answer.category) ? answer.category : null;
    if (topic.modelCategory !== null) outcome.answered += 1;
  }
  return outcome;
}
