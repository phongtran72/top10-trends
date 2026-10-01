import path from "node:path";
import type { TrendItem } from "@/collectors/types";
import { normalize, type SplitOptions } from "@/lib/text";

// Text embeddings for topic matching: nomic-embed-text-v1.5 run locally with
// Transformers.js (ONNX Runtime on the CPU), English. Chosen on 2026-10-01
// over all-MiniLM-L6-v2: on 238 hand-checked cross-platform pairs it caught
// 66% of same-story pairs at 90% right merges, against 37% (PLAN.md › Ranking
// › Matching model). The model downloads from huggingface.co once and is
// cached in .cache/transformers, which collect.yml keeps between runs. Vectors
// are never stored (invariant 4); topic centroids are.

export const EMBEDDING_MODEL = "nomic-ai/nomic-embed-text-v1.5";
export const EMBEDDING_DTYPE = "q8"; // the 137 MB quantized weights
// The model's 768 numbers cut to 384 (Matryoshka), which scored the same as
// the full size and keeps topics.centroid at real[384].
export const EMBEDDING_DIMENSIONS = 384;
// nomic expects a task prefix; "clustering: " suits grouping titles into topics.
export const EMBEDDING_PREFIX = "clustering: ";
export const MODEL_CACHE_DIR = path.join(process.cwd(), ".cache", "transformers");

// Normalized vectors, one per text, in order.
export type Embedder = (texts: readonly string[]) => Promise<number[][]>;

// One text at a time: the 8-bit model scales its activations over a whole
// padded batch, so a batched text's vector depended on its batch-mates (the
// same pair scored 0.669, 0.681 or 0.695), and a borderline match could merge
// one hour and not the next. Unbatched is bit-identical in any order and costs
// about 0.2 s more per run.
const BATCH = 1;

export async function createEmbedder(): Promise<Embedder> {
  // Imported here so the website and the tests never load the model runtime.
  const { env, pipeline } = await import("@huggingface/transformers");
  env.cacheDir = MODEL_CACHE_DIR;
  const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: EMBEDDING_DTYPE });
  return async (texts) => {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH).map((text) => EMBEDDING_PREFIX + text);
      const output = await extractor(batch, { pooling: "mean" });
      vectors.push(...(output.tolist() as number[][]).map((vector) => matryoshka(vector)));
    }
    return vectors;
  };
}

// Matryoshka truncation as nomic's model card does it: layer norm over all of
// the model's dimensions, keep the first `dims`, then scale to unit length.
export function matryoshka(vector: readonly number[], dims = EMBEDDING_DIMENSIONS): number[] {
  const mean = vector.reduce((sum, x) => sum + x, 0) / vector.length;
  const variance = vector.reduce((sum, x) => sum + (x - mean) ** 2, 0) / vector.length;
  const std = Math.sqrt(variance + 1e-5);
  return unitVector(vector.slice(0, dims).map((x) => (x - mean) / std));
}

// What gets embedded: the normalized title plus up to two headlines. `keep`
// holds runs that hashtags leave whole (lib/text.ts plainWords).
export function embeddingText(item: Pick<TrendItem, "title" | "matchText">, options: SplitOptions = {}): string {
  return [item.title, ...(item.matchText ?? []).slice(0, 2)]
    .map((text) => normalize(text, options))
    .filter(Boolean)
    .join(". ");
}

export function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function unitVector(v: readonly number[]): number[] {
  const length = Math.sqrt(dot(v, v));
  return length === 0 ? [...v] : v.map((x) => x / length);
}

// Cosine similarity; for unit vectors it is just the dot product.
export function cosine(a: readonly number[], b: readonly number[]): number {
  const denominator = Math.sqrt(dot(a, a) * dot(b, b));
  return denominator === 0 ? 0 : dot(a, b) / denominator;
}
