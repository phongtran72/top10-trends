import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOPIC_CATEGORIES } from "@/config/naming";
import { EMBEDDING_DIMENSIONS, EMBEDDING_DTYPE, EMBEDDING_MODEL, EMBEDDING_PREFIX } from "@/lib/embed";
import { categorize, categoryProbabilities, loadCategoryModel, parseCategoryModel } from "./category-model";

const embedding = { model: EMBEDDING_MODEL, dtype: EMBEDDING_DTYPE, dimensions: EMBEDDING_DIMENSIONS, prefix: EMBEDDING_PREFIX };

// A made-up model: the first number of the vector says sports, the second
// politics, and being on Bluesky leans towards politics.
function tiny(threshold = 0.6) {
  const row = (first: number, second: number, bluesky: number) => {
    const weights = new Array<number>(EMBEDDING_DIMENSIONS + 1).fill(0);
    weights[0] = first;
    weights[1] = second;
    weights[EMBEDDING_DIMENSIONS] = bluesky;
    return weights;
  };
  return parseCategoryModel({
    version: "test",
    embedding,
    classes: ["sports", "politics"],
    platforms: ["bluesky"],
    dimensions: EMBEDDING_DIMENSIONS,
    threshold,
    weights: [row(4, 0, 0), row(0, 4, 1)],
    bias: [0, 0],
  });
}

function vector(first: number, second: number): number[] {
  const out = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  out[0] = first;
  out[1] = second;
  return out;
}

const withText = { source: "google_trends" as const, matchText: ["A headline"] };

describe("categorize", () => {
  it("gives the most likely category with the model's version", () => {
    expect(categorize(tiny(), withText, vector(1, 0))).toEqual({ category: "sports", version: "test" });
    expect(categorize(tiny(), withText, vector(0, 1))).toEqual({ category: "politics", version: "test" });
  });

  it("gives no category below the threshold, and still says which model looked", () => {
    expect(categorize(tiny(), withText, vector(0.5, 0.5))).toEqual({ category: null, version: "test" });
    // Exactly at the threshold it answers, as the Python scorer does.
    expect(categorize(tiny(0.5), withText, vector(0.5, 0.5))).toEqual({ category: "sports", version: "test" });
  });

  it("looks only at an item with a stored text", () => {
    expect(categorize(tiny(), { source: "x" }, vector(1, 0))).toBeNull();
    expect(categorize(tiny(), { source: "google_trends", matchText: [] }, vector(1, 0))).toBeNull();
    expect(categorize(tiny(), { source: "google_trends", matchText: ["  "] }, vector(1, 0))).toBeNull();
  });

  it("adds the platform's weight for a platform it knows and nothing for one it doesn't", () => {
    const even = vector(0.5, 0.5);
    expect(categoryProbabilities(tiny(), even, "mastodon")).toEqual([0.5, 0.5]);
    const [sports, politics] = categoryProbabilities(tiny(), even, "bluesky");
    expect(politics).toBeCloseTo(1 / (1 + Math.exp(-1)), 12);
    expect(sports + politics).toBeCloseTo(1, 12);
  });

  it("refuses a vector of the wrong length", () => {
    expect(() => categoryProbabilities(tiny(), [1, 0], "x")).toThrow(/expected a vector of 384 numbers/);
  });
});

describe("parseCategoryModel", () => {
  const good = { ...tiny() };

  it("refuses a model trained on other vectors than the pipeline makes", () => {
    expect(() => parseCategoryModel({ ...good, embedding: { ...embedding, prefix: "search_query: " } })).toThrow(/retrain/);
    expect(() => parseCategoryModel({ ...good, embedding: { ...embedding, model: "another/model" } })).toThrow(/retrain/);
  });

  it("refuses weights of the wrong shape and categories outside the list", () => {
    expect(() => parseCategoryModel({ ...good, weights: [good.weights[0]] })).toThrow(/rows of weights/);
    expect(() => parseCategoryModel({ ...good, weights: [good.weights[0], [1, 2, 3]] })).toThrow(/must hold 385 numbers/);
    expect(() => parseCategoryModel({ ...good, classes: ["sports", "motorsport"] })).toThrow();
  });
});

// The model the pipeline loads, and the answers research's scorer gave on a
// few made-up inputs (research/topnews/category_model.py writes both files).
describe("config/models/category.json", () => {
  const model = loadCategoryModel();
  const parity = JSON.parse(readFileSync(path.join(process.cwd(), "config", "models", "category.parity.json"), "utf8")) as {
    version: string;
    cases: { source: string; vector: number[]; probabilities: number[]; category: string | null; confidence: number }[];
  };

  it("loads, with categories from the research list and one row of weights for each", () => {
    expect(model.version).toMatch(/^c\d+$/);
    expect(model.classes.every((name) => TOPIC_CATEGORIES.includes(name))).toBe(true);
    expect(model.weights).toHaveLength(model.classes.length);
  });

  it("scores as the Python scorer does", () => {
    expect(parity.version).toBe(model.version);
    expect(parity.cases.length).toBeGreaterThan(0);
    expect(parity.cases.length).toBeLessThanOrEqual(5);
    for (const example of parity.cases) {
      const probabilities = categoryProbabilities(model, example.vector, example.source);
      expect(probabilities).toHaveLength(example.probabilities.length);
      probabilities.forEach((p, k) => expect(p).toBeCloseTo(example.probabilities[k], 9));
      const item = { source: example.source as "google_trends", matchText: ["A made-up headline"] };
      expect(categorize(model, item, example.vector)).toEqual({ category: example.category, version: model.version });
    }
    // Both kinds of answer are in the cases: a category, and none.
    expect(parity.cases.some((example) => example.category !== null)).toBe(true);
    expect(parity.cases.some((example) => example.category === null)).toBe(true);
  });
});
