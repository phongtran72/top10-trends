import type { SourceId } from "@/collectors/registry";
import type { TrendItem } from "@/collectors/types";
import { EMBEDDING_DIMENSIONS, EMBEDDING_DTYPE, EMBEDDING_MODEL, embeddingText, type Embedder } from "@/lib/embed";
import { plainWords } from "@/lib/text";
import { checkItem, type DropReason } from "@/pipeline/filter";

// Title vectors for the research notebooks (research/, PLAN.md › Predictions
// and research). The notebooks compare trends across platforms the way the
// pipeline would: the same filters, the same text and the same model. A row's
// matchText is what the stored list kept for it (Google's headlines, Bluesky's
// description; trend_items.match_text, since migration 0005); older rows have
// only a title. The vectors go to research/data/, which git ignores, and never
// into the database (invariant 4).

export interface TitleRow {
  id: string; // the notebook's own id for the trend
  source: string;
  title: string;
  matchText?: string[] | null; // the item's stored match text, embedded with the title as the rank step does
  group?: string; // the hour it's embedded for: its words to keep whole come from that hour's titles
}

export interface GroupTitle {
  source: string;
  title: string;
  matchText?: string[] | null;
}

export interface TitleResult {
  id: string;
  kept: boolean;
  reason?: DropReason;
  detail?: string;
  index?: number; // row in the vector file, for kept titles
  text?: string; // what was embedded, for kept titles (so other models can be compared on the same text)
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
export function checkTitle(row: GroupTitle, blocklist: ReadonlySet<string>): ReturnType<typeof checkItem> {
  const item: TrendItem = {
    source: row.source as SourceId, region: "global", rank: 1, title: row.title, url: "", matchText: matchTextOf(row),
  };
  return checkItem(item, blocklist);
}

function matchTextOf(row: GroupTitle): string[] | undefined {
  return row.matchText?.length ? row.matchText : undefined;
}

// The texts whose plain words keep hashtag runs whole: titles and their match text, as in the rank step.
function keepSources(rows: readonly GroupTitle[]): string[] {
  return rows.flatMap((row) => [row.title, ...(matchTextOf(row) ?? [])]);
}

// The rank step keeps a hashtag's run whole when the run's other titles use
// it as a plain word ("#flydubai" next to "Flydubai flight diverts…"). Here a
// row's words to keep come from its group's titles, like one pipeline run;
// rows without a group, or without `groups`, share the kept rows' titles.
export async function embedTitles(
  rows: readonly TitleRow[],
  blocklist: ReadonlySet<string>,
  embed: Embedder,
  groups: Readonly<Record<string, readonly GroupTitle[]>> = {},
): Promise<TitleVectors> {
  const results: TitleResult[] = [];
  const kept: TitleRow[] = [];
  for (const row of rows) {
    const drop = checkTitle(row, blocklist);
    if (drop) {
      results.push({ id: row.id, kept: false, ...drop });
    } else {
      results.push({ id: row.id, kept: true, index: kept.length });
      kept.push(row);
    }
  }
  const everyone = plainWords(keepSources(kept));
  const keepByGroup = new Map<string, Set<string>>();
  const keepFor = (group: string | undefined) => {
    const titles = group === undefined ? undefined : groups[group];
    if (!titles) return everyone;
    if (!keepByGroup.has(group!)) {
      keepByGroup.set(group!, plainWords(keepSources(titles.filter((t) => !checkTitle(t, blocklist)))));
    }
    return keepByGroup.get(group!)!;
  };
  const texts = kept.map((row) => embeddingText({ title: row.title, matchText: matchTextOf(row) }, { keep: keepFor(row.group) }));
  for (const result of results) if (result.index !== undefined) result.text = texts[result.index];
  const embedded = texts.length > 0 ? await embed(texts) : [];
  const vectors = new Float32Array(embedded.length * EMBEDDING_DIMENSIONS);
  embedded.forEach((vector, i) => vectors.set(vector, i * EMBEDDING_DIMENSIONS));
  return { model: EMBEDDING_MODEL, dtype: EMBEDDING_DTYPE, dimensions: EMBEDDING_DIMENSIONS, rows: results, vectors };
}
