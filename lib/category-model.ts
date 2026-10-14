import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { TrendItem } from "@/collectors/types";
import { TOPIC_CATEGORIES, type TopicCategory } from "@/config/naming";
import { EMBEDDING_DIMENSIONS, EMBEDDING_DTYPE, EMBEDDING_MODEL, EMBEDDING_PREFIX } from "@/lib/embed";

// The category classifier (task 5.14, PLAN.md › Predictions and research › Who
// writes a topic's category): a logistic regression on an item's embedding and
// its platform, trained in research/ (topnews.category_model) and shipped as
// config/models/category.json. Scoring is one matrix product, so the pipeline
// runs it on vectors it already has.
//
// It answers only for an item with a stored text (a Google Trends headline, a
// Bluesky description): on bare names it was right too rarely to keep. Its
// answer goes in `topics.model_category` with the model's version beside it,
// never in `topics.category`, which is Claude's (invariant 9), and it is never
// used in matching.

const Model = z.object({
  version: z.string().min(1), // goes in topics.model_category_version
  // The vectors it was trained on. It is only right on vectors made the same way.
  embedding: z.object({ model: z.string(), dtype: z.string(), dimensions: z.number().int(), prefix: z.string() }),
  classes: z.array(z.enum(TOPIC_CATEGORIES)).min(2),
  platforms: z.array(z.string()), // one input after the vector for each; empty when the platform isn't used
  dimensions: z.number().int().positive(),
  threshold: z.number().min(0).max(1), // below this probability it gives no category
  weights: z.array(z.array(z.number())), // classes × (dimensions + platforms)
  bias: z.array(z.number()),
});
export type CategoryModel = z.infer<typeof Model>;

export function parseCategoryModel(raw: unknown): CategoryModel {
  const model = Model.parse(raw);
  const width = model.dimensions + model.platforms.length;
  if (model.weights.length !== model.classes.length || model.bias.length !== model.classes.length) {
    throw new Error(`category model ${model.version}: expected ${model.classes.length} rows of weights and biases`);
  }
  if (model.weights.some((row) => row.length !== width)) {
    throw new Error(`category model ${model.version}: every row of weights must hold ${width} numbers`);
  }
  const made = model.embedding;
  if (
    made.model !== EMBEDDING_MODEL ||
    made.dtype !== EMBEDDING_DTYPE ||
    made.prefix !== EMBEDDING_PREFIX ||
    made.dimensions !== EMBEDDING_DIMENSIONS ||
    model.dimensions !== EMBEDDING_DIMENSIONS
  ) {
    throw new Error(`category model ${model.version} was trained on other vectors than the pipeline makes; retrain it`);
  }
  return model;
}

export function loadCategoryModel(file = path.join(process.cwd(), "config", "models", "category.json")): CategoryModel {
  return parseCategoryModel(JSON.parse(readFileSync(file, "utf8")));
}

// Each class's probability, in the order of `model.classes`: softmax of
// weights · inputs + bias, where the inputs are the vector and then 1 for the
// item's platform. A platform the model never saw adds nothing.
export function categoryProbabilities(model: CategoryModel, vector: readonly number[], source: string): number[] {
  if (vector.length !== model.dimensions) {
    throw new Error(`category model ${model.version}: expected a vector of ${model.dimensions} numbers, got ${vector.length}`);
  }
  const platform = model.platforms.indexOf(source);
  const scores = model.weights.map((row, k) => {
    let sum = model.bias[k] + (platform >= 0 ? row[model.dimensions + platform] : 0);
    for (let i = 0; i < model.dimensions; i++) sum += row[i] * vector[i];
    return sum;
  });
  const top = Math.max(...scores);
  const exp = scores.map((score) => Math.exp(score - top));
  const total = exp.reduce((sum, x) => sum + x, 0);
  return exp.map((x) => x / total);
}

export interface Categorized {
  category: TopicCategory | null; // null: it looked and wasn't sure
  version: string;
}

// The category of one item from its embedding, as the rank step has it. Null
// when the item has no stored text: there is nothing to look at, and nothing
// is written. Otherwise the version is always written, and the category when
// the model is sure enough.
export function categorize(
  model: CategoryModel,
  item: Pick<TrendItem, "source" | "matchText">,
  vector: readonly number[],
): Categorized | null {
  if (!item.matchText?.some((text) => text.trim())) return null;
  const probabilities = categoryProbabilities(model, vector, item.source);
  const best = probabilities.indexOf(Math.max(...probabilities));
  return { category: probabilities[best] >= model.threshold ? model.classes[best] : null, version: model.version };
}
