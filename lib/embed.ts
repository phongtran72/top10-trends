import path from "node:path";
import type { TrendItem } from "@/collectors/types";
import { normalize, type SplitOptions } from "@/lib/text";

// Text embeddings for topic matching: all-MiniLM-L6-v2 run locally with
// Transformers.js (ONNX Runtime on the CPU), 384 dimensions, English. The
// model downloads from huggingface.co once and is cached in .cache/transformers,
// which collect.yml keeps between runs. Vectors are never stored (invariant 4).

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DTYPE = "q8"; // the 23 MB quantized weights
export const EMBEDDING_DIMENSIONS = 384;
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
      const output = await extractor([...texts.slice(i, i + BATCH)], { pooling: "mean", normalize: true });
      vectors.push(...(output.tolist() as number[][]));
    }
    return vectors;
  };
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
