import { EMBEDDING_DIMENSIONS, type Embedder, unitVector } from "@/lib/embed";

// A deterministic stand-in for the real model in tests: each word hashes to a
// dimension, so texts that share words point the same way. No network. Its
// similarities aren't the real model's, so tests that match pass
// WORD_EMBEDDER_THRESHOLD rather than relying on MATCH_THRESHOLD.
export const WORD_EMBEDDER_THRESHOLD = 0.8;
export const wordEmbedder: Embedder = async (texts) =>
  texts.map((text) => {
    const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let hash = 0;
      for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
      vector[hash % EMBEDDING_DIMENSIONS] += 1;
    }
    return unitVector(vector);
  });
