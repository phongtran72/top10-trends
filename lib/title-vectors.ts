import type { SourceId } from "@/collectors/registry";
import type { TrendItem } from "@/collectors/types";
import { EMBEDDING_DIMENSIONS, EMBEDDING_DTYPE, EMBEDDING_MODEL, embeddingText, type Embedder } from "@/lib/embed";
import { checkItem, type DropReason } from "@/pipeline/filter";

// Title vectors for the research notebooks (research/, PLAN.md › Predictions
// and research). The notebooks compare trends across platforms the way the
// pipeline would: the same filters, the same text and the same model. Only
// titles are available, because stored lists keep no headlines. The vectors
// go to research/data/, which git ignores, and never into the database
// (invariant 4).

export interface TitleRow {
  id: string; // the notebook's own id for the trend
  source: string;
  title: string;
}

export interface TitleResult {
  id: string;
  kept: boolean;
  reason?: DropReason;
  detail?: string;
  index?: number; // row in the vector file, for kept titles
}

export interface TitleVectors {
  model: string;
  dtype: string;
  dimensions: number;
  rows: TitleResult[];
  vectors: Float32Array; // kept rows only, one after another
}

// The pipeline's filters, minus the ones that read flags the stored lists
// don't keep (NSFW, Bluesky's status).
export function checkTitle(row: TitleRow, blocklist: ReadonlySet<string>): ReturnType<typeof checkItem> {
  const item: TrendItem = { source: row.source as SourceId, region: "global", rank: 1, title: row.title, url: "" };
  return checkItem(item, blocklist);
}

export async function embedTitles(rows: readonly TitleRow[], blocklist: ReadonlySet<string>, embed: Embedder): Promise<TitleVectors> {
  const results: TitleResult[] = [];
  const texts: string[] = [];
  for (const row of rows) {
    const drop = checkTitle(row, blocklist);
    if (drop) {
      results.push({ id: row.id, kept: false, ...drop });
    } else {
      results.push({ id: row.id, kept: true, index: texts.length });
      texts.push(embeddingText({ title: row.title }));
    }
  }
  const embedded = texts.length > 0 ? await embed(texts) : [];
  const vectors = new Float32Array(embedded.length * EMBEDDING_DIMENSIONS);
  embedded.forEach((vector, i) => vectors.set(vector, i * EMBEDDING_DIMENSIONS));
  return { model: EMBEDDING_MODEL, dtype: EMBEDDING_DTYPE, dimensions: EMBEDDING_DIMENSIONS, rows: results, vectors };
}
